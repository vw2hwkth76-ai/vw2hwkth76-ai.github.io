import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { utf8 } from "../src/archive/bytes.ts";
import { openEtsArchive } from "../src/archive/ets-archive.ts";
import { BASELINE_PREDICTORS } from "../src/bench/baseline.ts";
import { parseGold } from "../src/bench/gold.ts";
import { score } from "../src/bench/score.ts";
import { loadKnxProject } from "../src/ets/load.ts";
import { buildGraph } from "../src/graph/evidence-graph.ts";
import { anonymizeKnxproj } from "../src/tools/anonymize.ts";
import { readFixture } from "./helpers.ts";

const NS = 'xmlns="http://knx.org/xml/project/23"';
const SENSITIVE = zipSync({
  "knx_master.xml": utf8(`<?xml version="1.0"?><KNX ${NS}><MasterData /></KNX>`),
  "P-0ABC/project.xml": utf8(
    `<?xml version="1.0"?><KNX ${NS} CreatedBy="ETS6"><Project Id="P-0ABC">` +
      `<ProjectInformation Name="Familie Mustermann, Hauptstr. 5" ProjectNumber="4711" Guid="12345678-1234-4234-8234-123456789abc" Comment="Schluessel beim Nachbarn">` +
      `<ProjectTraces><ProjectTrace User="Max Mustermann" Comment="Abnahme" /></ProjectTraces>` +
      `</ProjectInformation></Project></KNX>`,
  ),
  "P-0ABC/0.xml": utf8(
    `<?xml version="1.0"?><KNX ${NS}><Project Id="P-0ABC"><Installations><Installation Name="Villa Mustermann" BCUKey="4294967295">` +
      `<Topology><Area Address="1"><Line Address="1"><Segment Id="S">` +
      `<DeviceInstance Id="P-0ABC-0_DI-1" Address="1" Name="IP-Router Mustermann" SerialNumber="00FA:12345678" ProductRefId="M-1_P" Hardware2ProgramRefId="M-1_HP">` +
      `<Security DeviceAuthenticationCode="geheim" ToolKey="AAAA" /><IPConfig IPAddress="192.168.178.20" SubnetMask="255.255.255.0" />` +
      `</DeviceInstance></Segment></Line></Area></Topology>` +
      `<GroupAddresses><GroupRanges><GroupRange Id="P-0ABC-0_GR-1" Name="Licht" RangeStart="2048" RangeEnd="4095">` +
      `<GroupAddress Id="P-0ABC-0_GA-1" Address="2049" Name="Zimmer Lena Decke" Key="c2VjcmV0a2V5MTIzNDU2Nw==" DatapointType="DPST-1-1" Comment="{\\rtf1 privat}" />` +
      `</GroupRange></GroupRanges></GroupAddresses>` +
      `<Locations><Space Type="Building" Id="P-0ABC-0_BP-1" Name="Haus Mustermann"><Space Type="Room" Id="P-0ABC-0_BP-2" Name="Kinderzimmer" /></Space></Locations>` +
      `</Installation></Installations></Project></KNX>`,
  ),
  "P-0ABC.signature": utf8("signatur"),
});

async function text(data: Uint8Array): Promise<string> {
  const archive = await openEtsArchive(data);
  const parts = [archive.projectXml, ...archive.installationXmls].map((name) => archive.readProjectFile(name));
  return (await Promise.all(parts)).map((part) => new TextDecoder().decode(part)).join("\n");
}

describe("anonymizeKnxproj", () => {
  it("entfernt Schluessel, Kennungen, Netzangaben, Verlauf und Kommentare", async () => {
    const { output, report } = await anonymizeKnxproj(SENSITIVE, { replacements: { Mustermann: "Person 1", Lena: "Kind 1" } });
    const xml = await text(output);
    for (const secret of ["c2VjcmV0", "geheim", "ToolKey", "BCUKey", "00FA:12345678", "192.168.178.20", "Max Mustermann", "Nachbarn", "rtf1", "4711", "12345678-1234"]) {
      expect(xml).not.toContain(secret);
    }
    expect(xml).not.toContain("Mustermann");
    expect(xml).toContain('Name="Zimmer Kind 1 Decke"');
    expect(xml).toContain('Name="Gebäude 1"');
    expect(xml).toContain('Name="Kinderzimmer"');
    expect(xml).toContain('Name="Anonymisiertes Projekt"');
    expect(report.removedSecrets).toBe(5);
    expect(report.removedElements).toBe(3);
    expect(report.keptFiles).not.toContain("P-0ABC.signature");
  });

  it("listet seltene Namenswoerter zur Pruefung", async () => {
    const { report } = await anonymizeKnxproj(SENSITIVE);
    const words = report.namesToReview.map((entry) => entry.word);
    expect(words).toContain("Lena");
    expect(words).not.toContain("Licht");
  });

  it("laesst Struktur und Benchmark unveraendert", async () => {
    const original = readFixture("oeffentlich/demoprojekt.knxproj");
    const { output } = await anonymizeKnxproj(original);
    const gold = parseGold(JSON.parse(new TextDecoder().decode(readFixture("oeffentlich/demoprojekt.gold.json"))) as unknown);
    const before = score(buildGraph(await loadKnxProject(original)), gold, BASELINE_PREDICTORS[1]!);
    const after = score(buildGraph(await loadKnxProject(output)), gold, BASELINE_PREDICTORS[1]!);
    expect(after.dimensions).toEqual(before.dimensions);
    expect((await loadKnxProject(output)).manufacturer.applications.size).toBe(5);
  });

  it("oeffnet geschuetzte Projekte und schreibt sie ohne Passwort", async () => {
    const { output } = await anonymizeKnxproj(readFixture("archiv/ets6-geschuetzt.knxproj"), { password: "Grüße-2026" });
    const archive = await openEtsArchive(output);
    expect(archive.passwordProtected).toBe(false);
    expect(await text(output)).toContain("Decke schalten");
  });
});
