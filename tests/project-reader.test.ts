import { describe, expect, it } from "vitest";
import { normalizeDpt, parseDptList, dptDotted } from "../src/ets/dpt-id.ts";
import { formatGroupAddress, readEtsProject } from "../src/ets/project-reader.ts";
import { XmlError } from "../src/xml/sax.ts";
import { hasFixture, memoryArchive, openFixture } from "./helpers.ts";

const PROJECT_XML = `﻿<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20" CreatedBy="ETS5" ToolVersion="5.6">
  <Project Id="P-0001"><ProjectInformation Name="Handfall" GroupAddressStyle="ThreeLevel" /></Project>
</KNX>`;

describe("Gruppenadressen und DPT-Kennungen", () => {
  it("formatiert alle drei GA-Stile aus demselben Integer", () => {
    expect(formatGroupAddress(2304, "ThreeLevel")).toBe("1/1/0");
    expect(formatGroupAddress(2304, "TwoLevel")).toBe("1/256");
    expect(formatGroupAddress(2304, "Free")).toBe("2304");
  });

  it("normalisiert DPT-Schreibweisen", () => {
    expect(normalizeDpt("DPST-1-001")).toBe("DPST-1-1");
    expect(normalizeDpt("dpt-9")).toBe("DPT-9");
    expect(normalizeDpt("9.001")).toBe("DPST-9-1");
    expect(normalizeDpt("Unsinn")).toBeUndefined();
    expect(parseDptList("DPT-1 DPT-1 DPST-1-8")).toEqual(["DPT-1", "DPST-1-8"]);
    expect(dptDotted("DPST-5-1")).toBe("5.001");
    expect(dptDotted("DPT-9")).toBe("9.*");
  });
});

describe("readEtsProject", () => {
  it("liest ETS5 mit Funktionen, Gebaeudestruktur und GA-Hierarchie (style1)", async () => {
    const project = await readEtsProject(await openFixture("oeffentlich/style1.knxproj"));
    expect(project.createdBy).toBe("ETS5");
    expect(project.groupAddresses).toHaveLength(251);
    expect(project.functions).toHaveLength(98);
    expect(project.devices).toHaveLength(0);

    const ga = project.groupAddresses.find((entry) => entry.address === 2304);
    expect(ga?.name).toBe("Living room Ceiling light switching");
    expect(ga?.dpts).toEqual(["DPST-1-1"]);
    const ranges = new Map(project.groupRanges.map((range) => [range.id, range.name]));
    expect(ga?.rangeIds.map((id) => ranges.get(id))).toHaveLength(2);

    const fn = project.functions.find((entry) => entry.links.some((link) => link.groupAddressId === ga?.id));
    expect(fn?.links.find((link) => link.groupAddressId === ga?.id)?.role).toBe("SwitchOnOff");
    expect(project.spaces.find((space) => space.id === fn?.spaceId)?.name).toBe("Living room");
  });

  it("liest Geraete, Topologie, Parameter und KO-Verknuepfungen (demoprojekt)", async () => {
    const project = await readEtsProject(await openFixture("oeffentlich/demoprojekt.knxproj"));
    expect(project.devices).toHaveLength(5);
    const actuator = project.devices.find((device) => device.id === "P-045C-0_DI-1");
    expect(actuator?.hardware2ProgramRefId).toBe("M-0083_H-250-1_HP-001B-22-AEFA");
    expect(actuator?.individualAddress).toMatch(/^\d+\.\d+\.2$/);
    const co = actuator?.comObjects.find((entry) => entry.refId === "O-0_R-24");
    expect(co?.text).toBe("A: Channel A");
    expect(co?.groupAddressIds).toEqual(["P-045C-0_GA-3"]);
    expect(co?.sendingGroupAddressId).toBe("P-045C-0_GA-3");
    const heating = project.devices.find((device) => device.id === "P-045C-0_DI-3");
    expect(heating?.parameters["M-0083_A-003B-24-3717_P-181_R-689"]).toBe("30");
    expect(project.diagnostics.filter((entry) => entry.code === "link.unknown-group-address")).toEqual([]);
  });

  it("liest das alte Connectors-Format mit sendender GA", async () => {
    const archive = memoryArchive({
      "P-0001/project.xml": PROJECT_XML,
      "P-0001/0.xml": `<?xml version="1.0"?><KNX xmlns="http://knx.org/xml/project/12"><Project Id="P-0001">
        <Installations><Installation Name="">
          <Topology><Area Address="1"><Line Address="1">
            <DeviceInstance Id="P-0001-0_DI-1" Address="5" ProductRefId="M-1_P" Hardware2ProgramRefId="M-1_HP">
              <ComObjectInstanceRefs>
                <ComObjectInstanceRef RefId="M-1_A-1_O-0_R-1" ReadFlag="Enabled">
                  <Connectors><Send GroupAddressRefId="P-0001-0_GA-2" /><Receive GroupAddressRefId="P-0001-0_GA-1" /></Connectors>
                </ComObjectInstanceRef>
              </ComObjectInstanceRefs>
            </DeviceInstance>
          </Line></Area></Topology>
          <GroupAddresses><GroupRanges>
            <GroupRange Id="P-0001-0_GR-1" Name="Licht" RangeStart="2048" RangeEnd="4095">
              <GroupRange Id="P-0001-0_GR-2" Name="Kueche" RangeStart="2304" RangeEnd="2559">
                <GroupAddress Id="P-0001-0_GA-1" Address="2304" Name="Decke" />
                <GroupAddress Id="P-0001-0_GA-2" Address="2305" Name="Decke RM" />
              </GroupRange>
            </GroupRange>
          </GroupRanges></GroupAddresses>
        </Installation></Installations></Project></KNX>`,
    });
    const project = await readEtsProject(archive);
    const co = project.devices[0]?.comObjects[0];
    expect(project.devices[0]?.individualAddress).toBe("1.1.5");
    expect(co?.groupAddressIds).toEqual(["P-0001-0_GA-2", "P-0001-0_GA-1"]);
    expect(co?.sendingGroupAddressId).toBe("P-0001-0_GA-2");
    expect(co?.flags).toEqual({ read: true });
    expect(project.groupAddresses[1]?.rangeIds).toEqual(["P-0001-0_GR-1", "P-0001-0_GR-2"]);
  });

  it("weist DOCTYPE ab", async () => {
    const archive = memoryArchive({
      "P-0001/project.xml": `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><KNX />`,
      "P-0001/0.xml": "<KNX />",
    });
    await expect(readEtsProject(archive)).rejects.toBeInstanceOf(XmlError);
  });

  it("meldet beschaedigtes XML statt still weiterzulaufen", async () => {
    const archive = memoryArchive({ "P-0001/project.xml": PROJECT_XML, "P-0001/0.xml": "<KNX><Project>" });
    await expect(readEtsProject(archive)).rejects.toBeInstanceOf(XmlError);
  });

  it.skipIf(!hasFixture("privat/musterprojekt-ets6.knxproj"))(
    "liest ETS6 mit Kanaelen aus dem GroupObjectTree (privates Musterprojekt)",
    async () => {
      const project = await readEtsProject(await openFixture("privat/musterprojekt-ets6.knxproj"));
      expect(project.schemaVersion).toBe(23);
      expect(project.groupAddresses).toHaveLength(194);
      expect(project.devices).toHaveLength(40);
      const withChannel = project.devices.flatMap((device) => device.comObjects).filter((co) => co.channelId);
      expect(withChannel.length).toBeGreaterThan(0);
      expect(project.devices.some((device) => device.channelNodes.length > 0)).toBe(true);
      expect(project.spaces.find((space) => space.type === "DistributionBoard")?.name).toBe("Verteilung");
    },
  );
});
