/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/. */

CREATE TABLE ledger_write_order (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sequence INTEGER NOT NULL
);
INSERT INTO ledger_write_order (id, sequence) VALUES (1, 0);

ALTER TABLE gate_results ADD COLUMN write_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_features ADD COLUMN write_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE issues ADD COLUMN write_seq INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER gate_results_insert_write_seq AFTER INSERT ON gate_results
BEGIN
  UPDATE ledger_write_order SET sequence = sequence + 1 WHERE id = 1;
  UPDATE gate_results SET write_seq = (SELECT sequence FROM ledger_write_order WHERE id = 1)
  WHERE id = NEW.id;
END;

CREATE TRIGGER gate_results_update_write_seq
AFTER UPDATE OF gate_script, passed, exit_code, output ON gate_results
BEGIN
  UPDATE ledger_write_order SET sequence = sequence + 1 WHERE id = 1;
  UPDATE gate_results SET write_seq = (SELECT sequence FROM ledger_write_order WHERE id = 1)
  WHERE id = NEW.id;
END;
