/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { executeTestCommand } from "./test-runner.js";
it("rejects an actual Vite closeBundle failure after passing assertions", () => {
 const root = mkdtempSync(join(process.cwd(), ".runs/gwrk-close-review-"));
 try {
  writeFileSync(join(root,"good.test.js"),'import {test,expect} from "vitest";test("pass",()=>expect(1).toBe(1));');
  writeFileSync(join(root,"vitest.config.mjs"),`import {writeFileSync} from "node:fs"; export default {plugins:[{name:"close-failure",closeBundle(){writeFileSync(${JSON.stringify(join(root,"close.marker"))},"executed");throw new Error("ACTUAL_CLOSE_FAILURE_CANARY")}}],test:{include:["*.test.js"],maxWorkers:1,minWorkers:1}}`);
  const result=executeTestCommand("pnpm vitest run",{cwd:root,timeout:15000},{format:"vitest-json",vitest:{filters:[]}});
  console.log(JSON.stringify(result));
  expect(existsSync(join(root,"close.marker")),"actual closeBundle executed").toBe(true);
  expect(result.executionError,result.output).toBeTruthy();
  expect(result.ran).toBe(false);
 } finally {rmSync(root,{recursive:true,force:true});}
},20000);

it("preserves global teardown before normal project closure", () => {
 const root=mkdtempSync(join(process.cwd(),".runs/gwrk-close-order-"));
 try {
  const teardown=join(root,"teardown.marker");const closed=join(root,"closed.marker");
  writeFileSync(join(root,"good.test.js"),'import {test,expect} from "vitest";test("pass",()=>expect(1).toBe(1));');
  writeFileSync(join(root,"setup.mjs"),`import {writeFileSync} from "node:fs";export default()=>()=>writeFileSync(${JSON.stringify(teardown)},"done");`);
  writeFileSync(join(root,"vitest.config.mjs"),`import{existsSync,writeFileSync}from"node:fs";export default{plugins:[{name:"close-order",closeBundle(){if(!existsSync(${JSON.stringify(teardown)}))throw new Error("teardown order changed");writeFileSync(${JSON.stringify(closed)},"done")}}],test:{include:["*.test.js"],globalSetup:[${JSON.stringify(join(root,"setup.mjs"))}],maxWorkers:1,minWorkers:1}}`);
  const result=executeTestCommand("pnpm vitest run",{cwd:root,timeout:15000},{format:"vitest-json",vitest:{filters:[]}});
  expect(existsSync(teardown)).toBe(true);expect(existsSync(closed)).toBe(true);
  expect(result.executionError,result.output).toBeUndefined();expect(result).toMatchObject({passed:1,failed:0,ran:true});
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);

it("rejects a public reporter onClose callback failure", () => {
 const root=mkdtempSync(join(process.cwd(),".runs/gwrk-close-callback-"));
 try{
  const marker=join(root,"callback.marker");
  writeFileSync(join(root,"good.test.js"),'import {test,expect} from "vitest";test("pass",()=>expect(1).toBe(1));');
  const reporter=join(root,"reporter.mjs");writeFileSync(reporter,`import{writeFileSync}from"node:fs";export default class{onInit(ctx){ctx.onClose(async()=>{writeFileSync(${JSON.stringify(marker)},"done");throw new Error("close callback failure")})}}`);
  writeFileSync(join(root,"vitest.config.mjs"),`export default{test:{include:["*.test.js"],reporters:[${JSON.stringify(reporter)}],maxWorkers:1,minWorkers:1}}`);
  const result=executeTestCommand("pnpm vitest run",{cwd:root,timeout:15000},{format:"vitest-json",vitest:{filters:[]}});
  expect(existsSync(marker)).toBe(true);expect(result.executionError,result.output).toBeTruthy();expect(result.ran).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
