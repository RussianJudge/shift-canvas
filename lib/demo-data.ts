import type { SchedulerSnapshot } from "@/lib/types";

export const demoSchedulerSnapshot: SchedulerSnapshot = {
  month: "2026-03",
  productionUnits: [
    {
      id: "unit-casting",
      name: "Casting Hall",
      description: "High-throughput production line with rotating post coverage.",
    },
    {
      id: "unit-dispatch",
      name: "Dispatch Yard",
      description: "Outbound flow with dock, scale, and release coverage.",
    },
    {
      id: "unit-packaging",
      name: "Packaging Floor",
      description: "Pack-out, palletizing, and final QA staging.",
    },
  ],
  competencies: [
    { id: "comp-post-1", unitId: "unit-casting", code: "Post 1", label: "Furnace feed", colorToken: "amber" },
    { id: "comp-post-11", unitId: "unit-casting", code: "Post 11", label: "Mold prep", colorToken: "teal" },
    { id: "comp-post-12", unitId: "unit-casting", code: "Post 12", label: "Pour line", colorToken: "violet" },
    { id: "comp-post-21", unitId: "unit-casting", code: "Post 21", label: "Quality bay", colorToken: "rose" },
    { id: "comp-dock-2", unitId: "unit-dispatch", code: "Dock 2", label: "Scale + manifest", colorToken: "blue" },
    { id: "comp-dock-7", unitId: "unit-dispatch", code: "Dock 7", label: "Release gate", colorToken: "lime" },
    { id: "comp-dock-9", unitId: "unit-dispatch", code: "Dock 9", label: "Outbound staging", colorToken: "orange" },
    { id: "comp-pack-3", unitId: "unit-packaging", code: "Pack 3", label: "Case pack line", colorToken: "teal" },
    { id: "comp-pack-6", unitId: "unit-packaging", code: "Pack 6", label: "Palletizing", colorToken: "blue" },
    { id: "comp-pack-9", unitId: "unit-packaging", code: "Pack 9", label: "Final QA hold", colorToken: "rose" },
  ],
  schedules: [
    {
      id: "schedule-casting-601",
      unitId: "unit-casting",
      name: "Casting 601",
      startDate: "2026-01-01",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        { id: "emp-ava", name: "Ava Patel", role: "Senior Operator", scheduleId: "schedule-casting-601", competencyIds: ["comp-post-1", "comp-post-11", "comp-post-12"] },
        { id: "emp-siena", name: "Siena Morales", role: "Team Lead", scheduleId: "schedule-casting-601", competencyIds: ["comp-post-1", "comp-post-21"] },
      ],
    },
    {
      id: "schedule-casting-602",
      unitId: "unit-casting",
      name: "Casting 602",
      startDate: "2026-01-04",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        { id: "emp-noah", name: "Noah Kim", role: "Relief Operator", scheduleId: "schedule-casting-602", competencyIds: ["comp-post-11", "comp-post-21"] },
        { id: "emp-owen", name: "Owen Clarke", role: "Operator", scheduleId: "schedule-casting-602", competencyIds: ["comp-post-11", "comp-post-12"] },
      ],
    },
    {
      id: "schedule-dispatch-601",
      unitId: "unit-dispatch",
      name: "Dispatch 601",
      startDate: "2026-01-01",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        { id: "emp-cam", name: "Cam Russell", role: "Dispatch Lead", scheduleId: "schedule-dispatch-601", competencyIds: ["comp-dock-2", "comp-dock-7"] },
        { id: "emp-nina", name: "Nina Brooks", role: "Yard Controller", scheduleId: "schedule-dispatch-601", competencyIds: ["comp-dock-2", "comp-dock-7"] },
      ],
    },
    {
      id: "schedule-packaging-603",
      unitId: "unit-packaging",
      name: "Packaging 603",
      startDate: "2026-01-07",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        { id: "emp-maia", name: "Maia Chen", role: "QA Tech", scheduleId: "schedule-packaging-603", competencyIds: ["comp-pack-6", "comp-pack-9"] },
        { id: "emp-gia", name: "Gia Turner", role: "Packaging Tech", scheduleId: "schedule-packaging-603", competencyIds: ["comp-pack-3", "comp-pack-6", "comp-pack-9"] },
      ],
    },
  ],
  assignments: [],
};
