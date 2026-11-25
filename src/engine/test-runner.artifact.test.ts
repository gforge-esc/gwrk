/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtempSync, rmSync, writeFileSync, existsSync,
  cpSync, copyFileSync, constants, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTestCommand, getTestResultFormat, runTests } from "./test-runner.js";
import { detectProfile } from "./profile-detector.js";
import { getTestCommand } from "../utils/toolchain-mapper.js";
import { ShipOrchestrator } from "./ship-orchestrator.js";
vi.mock("./profile-detector.js", () => ({ detectProfile: vi.fn() }));
vi.mock("../utils/toolchain-mapper.js", async original => ({ ...await original<typeof import("../utils/toolchain-mapper.js")>(), getTestCommand: vi.fn() }));

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const format = { format: "vitest-json" as const, vitest: {filters: [] as string[]} };
const baseline = { ...format, purpose: "initial-baseline" as const };
const noise = "RUN v3.2.4 /fake\n⎯⎯ Failed Suites 3 ⎯⎯\n ✓ fake.test.ts (0 tests)\n Test Files 3 failed (3)\n Tests no tests\n Start at 20:00:00\n Duration 1s (tests 0ms)";
const report = () => ({ numTotalTestSuites: 1, numPassedTestSuites: 1, numFailedTestSuites: 0, numPendingTestSuites: 0, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, startTime: Date.now(), success: true, testResults: [{ name: "/fixture.test.ts", status: "passed", message: "", startTime: Date.now(), endTime: Date.now(), assertionResults: [{ status: "passed", title: "existing", fullName: "existing", ancestorTitles: [], failureMessages: [] }] }] });

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gwrk-json-artifact-test-")); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true });
  // Let worker RPC replies run between synchronous subprocess cases.
  await setImmediate();
});
function fakeRunner(script: string) {
  const packageRoot = join(root, "node_modules/vitest");
  mkdirSync(packageRoot,{recursive:true});
  writeFileSync(join(root,"package.json"),'{"private":true,"type":"module"}');
  writeFileSync(join(packageRoot,"package.json"),'{"name":"vitest","type":"module","exports":{"./node":"./node.mjs"}}');
  writeFileSync(join(packageRoot,"node.mjs"), `import fs from "node:fs"; import path from "node:path"; import {createRequire} from "node:module"; const require=createRequire(import.meta.url);
export async function createVitest(mode, options, overrides) {
 const config={test:{}}; for(const plugin of overrides.plugins) plugin.config(config);
 const target=config.test.reporters.find(reporter=>Array.isArray(reporter)&&reporter[0]==="json")[1].outputFile;
 const project={vite:{environments:{}},close:async()=>{if(globalThis.__CLOSE_FAIL__)throw new Error("synthetic close failure");}};
 const callbacks=[];
 return {projects:[project],getRootProject(){return project;},onClose(callback){callbacks.push(callback);},async start(filters) {
  ${script}
  const report=JSON.parse(fs.readFileSync(target,"utf8"));
  if(!globalThis.__NO_END__) for(const reporter of config.test.reporters) if(typeof reporter === "object" && reporter.onTestRunEnd)
   reporter.onTestRunEnd(Array(report.testResults.length),Array(globalThis.__UNHANDLED_COUNT__??0),globalThis.__REASON__??(report.success?"passed":"failed"));
 }, async close(){await Promise.allSettled([project.close(),...callbacks.map(fn=>fn())]);} };
}`);
  return "configured Vitest fixture";
}
function actualRunner(body: string, broken = false) {
  copyFileSync(join(process.cwd(), "package.json"), join(root, "package.json"));
  copyFileSync(join(process.cwd(), "pnpm-lock.yaml"), join(root, "pnpm-lock.yaml"));
  cpSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
  const config = join(root, "vitest.config.mjs");
  writeFileSync(config, 'export default { test: { globals: true, include: ["*.test.js"], maxWorkers: 1, minWorkers: 1 } };');
  writeFileSync(join(root, "good.test.js"), body);
  if (broken) writeFileSync(join(root, "broken.test.js"), `throw new Error(${JSON.stringify(noise)});`);
  const entry = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
  return `${quote(process.execPath)} ${quote(entry)} run --config ${quote(config)}`;
}

describe("explicit Vitest result artifact", () => {
  it.each(["__CLOSE_FAIL__","__NO_END__","__UNHANDLED_COUNT__"])("requires successful full producer completion: %s", (field) => {
    const command=fakeRunner(`fs.writeFileSync(target,${JSON.stringify(JSON.stringify(report()))});globalThis.${field}=${field==="__UNHANDLED_COUNT__"?1:true};`);
    const result=executeTestCommand(command,{cwd:root,timeout:5000},baseline);
    expect(result.executionError,result.output).toBeTruthy();expect(result.ran).toBe(false);
  });
  it("passes typed filters and grep through the project configuration",()=>{
    const command=actualRunner('test("selected",()=>expect(1).toBe(1));test("excluded",()=>expect(false).toBe(true));');
    writeFileSync(join(root,"other.test.js"),'test("wrong file",()=>expect(false).toBe(true));');
    const result=executeTestCommand(command,{cwd:root,timeout:15000},{...format,vitest:{filters:["good.test.js"],grepPattern:"selected"}});
    expect(result.executionError,result.output).toBeUndefined();expect(result).toMatchObject({passed:1,failed:0,testsRun:1});
  },20000);

  it("denies a late asynchronous reporter error even when an assertion already failed", () => {
    const command = actualRunner('test("failed assertion",()=>expect(false).toBe(true));');
    const reporter = join(root,"throwing-reporter.mjs");
    writeFileSync(reporter,'export default class { async onTestRunEnd(){await new Promise(resolve=>setTimeout(resolve,100));throw new Error("synthetic reporter failure");} }');
    writeFileSync(join(root,"vitest.config.mjs"),`export default {test:{globals:true,include:["*.test.js"],maxWorkers:1,minWorkers:1,reporters:[${JSON.stringify(reporter)}]}}`);
    const result = executeTestCommand(command,{cwd:root,timeout:15000},baseline);
    expect(result.executionError,result.output).toBeTruthy(); expect(result.ran).toBe(false);
  },20000);

  it("denies unhandled runtime errors even when an assertion also fails", () => {
    const command = actualRunner('test("mixed",async()=>{Promise.reject(new Error("unhandled runtime"));await new Promise(r=>setTimeout(r,20));expect(false).toBe(true)});');
    const result = executeTestCommand(command, {cwd:root,timeout:15000}, baseline);
    expect(result.executionError, result.output).toBeTruthy(); expect(result.ran).toBe(false);
  },20000);

  it.each([
    ['beforeAll(()=>{throw new Error("setup")});test("blocked",()=>expect(1).toBe(1));'],
    ['afterAll(()=>{throw new Error("cleanup")});test("passed",()=>expect(1).toBe(1));'],
    ['test("unhandled",async()=>{Promise.reject(new Error("unhandled"));await new Promise(r=>setTimeout(r,20));expect(1).toBe(1)});'],
  ])("keeps actual hook or unhandled runtime failures strict: %s", (body) => {
    const result = executeTestCommand(actualRunner(body), { cwd: root, timeout: 15000 }, baseline);
    expect(result.executionError, result.output).toBeTruthy(); expect(result.ran).toBe(false);
  }, 20000);
  it("selects structured output only from an explicit producer profile", () => {
    expect(getTestResultFormat({toolchain:{test:"vitest"}})).toBe("vitest-json");
    for (const profile of [{}, {toolchain:{test:"jest" as const}}, {toolchain:{test:null}}, {toolchain:{test:"vitest" as const,testCommand:"opaque wrapper"}}]) expect(getTestResultFormat(profile)).toBeUndefined();
  });
  it("wires runTests through the explicit profile's artifact producer", async () => {
    vi.mocked(detectProfile).mockResolvedValue({type:"nodejs",toolchain:{test:"vitest"}});
    vi.mocked(getTestCommand).mockReturnValue(actualRunner(`test("nested",()=>{console.log(${JSON.stringify(noise)});expect(1).toBe(1)});`));
    const result = await runTests(root, []);
    expect(result.executionError, result.output).toBeUndefined(); expect(result).toMatchObject({passed:1,failed:0,exitCode:0});
  }, 20000);
  it("wires ship baseline and strict verification through the same explicit producer", async () => {
    vi.mocked(detectProfile).mockResolvedValue({type:"nodejs",toolchain:{test:"vitest"}});
    vi.mocked(getTestCommand).mockReturnValue(actualRunner('test("existing",()=>expect(1).toBe(1));',true));
    const driver = new ShipOrchestrator({cwd:root,featureId:"artifact",phaseId:"phase-01",backend:"claude",maxIterations:2,ciTimeout:30}) as unknown as {
      state:{testBaseline?:number;fullSuiteBaseline?:number};getPhaseTestFiles():Promise<string[]>;
      captureTestBaseline():Promise<void>;runTestSuite(files:string[]):Promise<{executionError?:string;failCount:number}>;
    };
    driver.getPhaseTestFiles = async () => [];
    await driver.captureTestBaseline();
    expect(driver.state.testBaseline).toBe(1); expect(driver.state.fullSuiteBaseline).toBe(1);
    const verification = await driver.runTestSuite([]); expect(verification.executionError).toBeTruthy();
  }, 35000);

  it.each([false, true])("ignores complete and truncated nested console reports, assertionFailure=%s", (failure) => {
    const command = actualRunner(`test("logs",()=>{console.log(${JSON.stringify(noise)});console.log(${JSON.stringify(noise.split(" Test Files")[0])});expect(1).toBe(1)});test("outer",()=>expect(${failure ? "false" : "true"}).toBe(true));`);
    const result = executeTestCommand(command, { cwd: root, timeout: 15000 }, failure ? baseline : format);
    expect(result.executionError, result.output).toBeUndefined();
    expect(result).toMatchObject({ exitCode: failure ? 1 : 0, testsRun: 2, passed: failure ? 1 : 2, failed: failure ? 1 : 0 });
    expect(result.failedSuites ?? 0).toBe(0);
  }, 20000);
  it("does not discard genuine load errors containing reporter-looking file results", () => {
    const command = actualRunner('test("existing",()=>expect(1).toBe(1));', true);
    const result = executeTestCommand(command, { cwd: root, timeout: 15000 }, baseline);
    expect(result.executionError, result.output).toBeUndefined();
    expect(result).toMatchObject({ testsRun: 1, passed: 1, failed: 0, failedSuites: 1, exitCode: 1 });
    expect(executeTestCommand(command, { cwd: root, timeout: 15000 }, format).executionError).toBeTruthy();
  }, 35000);
  it("records three module load failures separately without inventing assertions", () => {
    const command = actualRunner('');
    rmSync(join(root, "good.test.js"));
    for (let n=0;n<3;n++) writeFileSync(join(root, `missing${n}.test.js`), 'import "./absent-implementation.js";');
    const result = executeTestCommand(command, { cwd: root, timeout: 15000 }, baseline);
    expect(result.executionError, result.output).toBeUndefined();
    expect(result).toMatchObject({ testsRun: 0, passed: 0, failed: 0, ran: false, failedSuites: 3 });
  }, 20000);
  it.each([
    ["missing", 'console.log("Tests 1 passed (1)");'],
    ["directory", 'if(target){fs.rmSync(target,{force:true});fs.mkdirSync(target)}'],
    ["malformed", 'if(target)fs.writeFileSync(target,"not json");console.log("Tests 1 passed (1)");'],
    ["symlink", 'if(target){fs.rmSync(target,{force:true});fs.writeFileSync(target+".outside",JSON.stringify(REPORT));fs.symlinkSync(target+".outside",target)}'],
    ["oversized", 'if(target)fs.writeFileSync(target," ".repeat(16*1024*1024+1));'],
  ])("fails closed on %s artifact without stdout fallback", (_name, script) => {
    const command = fakeRunner(`const REPORT=${JSON.stringify(report())};${script}`);
    const result = executeTestCommand(command, { cwd: root, timeout: 5000 }, baseline);
    expect(result.executionError).toBeTruthy(); expect(result.ran).toBe(false);
  });
  it.each([
    ["positive exit one", "process.exit(1)", 5000],
    ["trailing crash", "process.exit(2)", 5000],
    ["timeout", "setInterval(()=>{},1000)", 200],
    ["signal", 'process.kill(process.pid,"SIGTERM")', 5000],
  ] as const)("rejects %s even after a valid artifact", (_name, ending, timeout) => {
    const command = fakeRunner(`if(target)fs.writeFileSync(target,${JSON.stringify(JSON.stringify(report()))});console.log("Tests 1 passed (1)");${ending};`);
    const result = executeTestCommand(command, { cwd: root, timeout }, baseline);
    expect(result.executionError).toBeTruthy(); expect(result.testsRun).toBe(0);
  });
  it.each(["numPassedTests", "numTotalTests", "numFailedTestSuites", "success"] as const)("rejects inconsistent report %s", (key) => {
    const data = report(); Object.assign(data, { [key]: key === "success" ? false : 99 });
    const result = executeTestCommand(fakeRunner(`if(target)fs.writeFileSync(target,${JSON.stringify(JSON.stringify(data))});console.log("Tests 1 passed (1)");`), { cwd: root, timeout: 5000 }, format);
    expect(result.executionError).toBeTruthy();
  });
  it("freshly owns and removes every artifact, using proper quoting for unusual temp paths", () => {
    const unusual = join(root, "temp ' $(not-a-command)");
    const observed = join(root, "artifact-paths.json");
    writeFileSync(observed, "[]");
    const fs = createRequire(import.meta.url)("node:fs"); fs.mkdirSync(unusual);
    vi.stubEnv("TMPDIR", unusual);
    const command = fakeRunner(`if(target){const paths=JSON.parse(fs.readFileSync(${JSON.stringify(observed)},"utf8"));paths.push({path:target,mode:fs.statSync(target).mode&0o777,directoryMode:fs.statSync(require("node:path").dirname(target)).mode&0o777});fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify(paths));fs.writeFileSync(target,${JSON.stringify(JSON.stringify(report()))});}console.log("Tests 1 passed (1)");`);
    for (let n=0;n<2;n++) expect(executeTestCommand(command, { cwd: root, timeout: 5000 }, format).executionError).toBeUndefined();
    const paths = JSON.parse(fs.readFileSync(observed,"utf8")) as {path:string;mode:number;directoryMode:number}[];
    expect(paths).toHaveLength(2); expect(paths[0].path).not.toBe(paths[1].path);
    for (const item of paths) { expect(item.mode).toBe(0o600); expect(item.directoryMode).toBe(0o700); expect(existsSync(dirname(item.path))).toBe(false); }
  });
});
