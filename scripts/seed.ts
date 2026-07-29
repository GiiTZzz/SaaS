import { db } from "../src/lib/db";

const WORKING_HOURS = JSON.stringify({
  "1": [["07:00", "17:00"]],
  "2": [["07:00", "17:00"]],
  "3": [["07:00", "17:00"]],
  "4": [["07:00", "17:00"]],
  "5": [["07:00", "15:00"]],
  "6": [["08:00", "12:00"]],
});

db()
  .prepare(
    `INSERT OR REPLACE INTO tradesperson
       (id, name, trade, phone, slot_minutes, working_hours, hold_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  .run("tp_demo", "Topenářství Novák", "Topení a plyn", "+420601234567", 90, WORKING_HOURS, 30);

console.log("Seeded tradesperson tp_demo.");
