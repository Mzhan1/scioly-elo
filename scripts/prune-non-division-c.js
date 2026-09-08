#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

const output = path.resolve(process.argv[2] ?? "output");
const divisionFiles = [
  "national_rankings.csv",
  "all_program_states.csv",
  "rating_history.csv",
  "event_rankings.csv",
  "all_event_states.csv",
  "event_rating_history.csv",
];

function parseCsvRecord(record) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < record.length; index += 1) {
    const character = record[index];
    if (character === '"') {
      if (quoted && record[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function writeLine(stream, line) {
  if (!stream.write(`${line}\n`)) {
    await new Promise((resolve) => stream.once("drain", resolve));
  }
}

async function filterDivisionFile(file) {
  const source = path.join(output, file);
  if (!fs.existsSync(source)) return null;
  const temporary = `${source}.division-c.tmp`;
  const input = readline.createInterface({ input: fs.createReadStream(source) });
  const destination = fs.createWriteStream(temporary);
  let divisionIndex = -1;
  let kept = 0;
  let removed = 0;

  for await (const line of input) {
    if (divisionIndex < 0) {
      divisionIndex = parseCsvRecord(line).indexOf("division");
      if (divisionIndex < 0) throw new Error(`${file} has no division column`);
      await writeLine(destination, line);
      continue;
    }
    const division = parseCsvRecord(line)[divisionIndex];
    if (division === "C") {
      await writeLine(destination, line);
      kept += 1;
    } else {
      removed += 1;
    }
  }

  await new Promise((resolve, reject) => destination.end((error) => error ? reject(error) : resolve()));
  fs.renameSync(temporary, source);
  return { file, kept, removed };
}

for (const file of divisionFiles) {
  const result = await filterDivisionFile(file);
  if (result) console.log(`${result.file}: kept ${result.kept}, removed ${result.removed}`);
}

const reportPath = path.join(output, "rebuild_report.json");
if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.divisions = ["C"];
  report.latestSeasonByDivision = { C: report.latestSeasonByDivision?.C };
  report.note = "Existing artifacts pruned to Division C; run a full rebuild to refresh aggregate report metrics.";
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
