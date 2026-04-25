import {
  formatEmployeeDisplayName,
  splitEmployeeDisplayName,
} from "@/lib/employee-names";
import type { SchedulerSnapshot } from "@/lib/types";

type DemoEmployee = Omit<SchedulerSnapshot["schedules"][number]["employees"][number], "firstName" | "lastName" | "email">;

/** Adds split name fields to compact demo rows while preserving display labels. */
function demoEmployee(employee: DemoEmployee): SchedulerSnapshot["schedules"][number]["employees"][number] {
  const nameParts = splitEmployeeDisplayName(employee.name);

  return {
    ...employee,
    email: null,
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    name: formatEmployeeDisplayName(nameParts),
  };
}

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
    { id: "comp-post-1", code: "Post 1", label: "Furnace feed", colorToken: "amber", requiredStaff: 2 },
    { id: "comp-post-11", code: "Post 11", label: "Mold prep", colorToken: "teal", requiredStaff: 2 },
    { id: "comp-post-12", code: "Post 12", label: "Pour line", colorToken: "violet", requiredStaff: 2 },
    { id: "comp-post-21", code: "Post 21", label: "Quality bay", colorToken: "rose", requiredStaff: 1 },
    { id: "comp-dock-2", code: "Dock 2", label: "Scale + manifest", colorToken: "blue", requiredStaff: 2 },
    { id: "comp-dock-7", code: "Dock 7", label: "Release gate", colorToken: "lime", requiredStaff: 1 },
    { id: "comp-dock-9", code: "Dock 9", label: "Outbound staging", colorToken: "orange", requiredStaff: 1 },
    { id: "comp-pack-3", code: "Pack 3", label: "Case pack line", colorToken: "teal", requiredStaff: 2 },
    { id: "comp-pack-6", code: "Pack 6", label: "Palletizing", colorToken: "blue", requiredStaff: 2 },
    { id: "comp-pack-9", code: "Pack 9", label: "Final QA hold", colorToken: "rose", requiredStaff: 1 },
  ],
  timeCodes: [
    { id: "time-ill", code: "ILL", label: "Illness", colorToken: "rose", usageMode: "manual" },
    { id: "time-absa", code: "ABSA", label: "Absent", colorToken: "orange", usageMode: "manual" },
    { id: "time-bot", code: "BOT", label: "Booked off", colorToken: "amber", usageMode: "manual" },
    { id: "time-days", code: "DAY", label: "Day shift", colorToken: "blue", usageMode: "manual" },
    { id: "time-nights", code: "NIGHT", label: "Night shift", colorToken: "violet", usageMode: "manual" },
    { id: "time-sim", code: "SIM", label: "Simulation", colorToken: "teal", usageMode: "manual" },
    { id: "time-v", code: "V", label: "Vacation", colorToken: "lime", usageMode: "manual" },
  ],
  schedules: [
    {
      id: "schedule-601",
      name: "601",
      startDate: "2026-01-01",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        demoEmployee({ id: "emp-ava", name: "Ava Patel", role: "Senior Operator", scheduleId: "schedule-601", competencyIds: ["comp-post-1", "comp-post-11", "comp-post-12"] }),
        demoEmployee({ id: "emp-cam", name: "Cam Russell", role: "Dispatch Lead", scheduleId: "schedule-601", competencyIds: ["comp-dock-2", "comp-dock-7"] }),
        demoEmployee({ id: "emp-kira", name: "Kira Walsh", role: "Packaging Lead", scheduleId: "schedule-601", competencyIds: ["comp-pack-3", "comp-pack-6"] }),
        demoEmployee({ id: "emp-siena", name: "Siena Morales", role: "Team Lead", scheduleId: "schedule-601", competencyIds: ["comp-post-1", "comp-post-21"] }),
        demoEmployee({ id: "emp-nina", name: "Nina Brooks", role: "Yard Controller", scheduleId: "schedule-601", competencyIds: ["comp-dock-2", "comp-dock-7"] }),
        demoEmployee({ id: "emp-dina", name: "Dina Scott", role: "Line Operator", scheduleId: "schedule-601", competencyIds: ["comp-pack-3", "comp-pack-9"] }),
      ],
    },
    {
      id: "schedule-602",
      name: "602",
      startDate: "2026-01-04",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        demoEmployee({ id: "emp-noah", name: "Noah Kim", role: "Relief Operator", scheduleId: "schedule-602", competencyIds: ["comp-post-11", "comp-post-21"] }),
        demoEmployee({ id: "emp-lena", name: "Lena Abbas", role: "Yard Specialist", scheduleId: "schedule-602", competencyIds: ["comp-dock-7", "comp-dock-9"] }),
        demoEmployee({ id: "emp-joel", name: "Joel Park", role: "Case Packer", scheduleId: "schedule-602", competencyIds: ["comp-pack-3", "comp-pack-9"] }),
        demoEmployee({ id: "emp-owen", name: "Owen Clarke", role: "Operator", scheduleId: "schedule-602", competencyIds: ["comp-post-11", "comp-post-12"] }),
        demoEmployee({ id: "emp-hugo", name: "Hugo Tran", role: "Manifest Clerk", scheduleId: "schedule-602", competencyIds: ["comp-dock-2", "comp-dock-9"] }),
        demoEmployee({ id: "emp-finn", name: "Finn Alvarez", role: "Palletizer", scheduleId: "schedule-602", competencyIds: ["comp-pack-6", "comp-pack-9"] }),
      ],
    },
    {
      id: "schedule-603",
      name: "603",
      startDate: "2026-01-07",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        demoEmployee({ id: "emp-jules", name: "Jules Martin", role: "Coordinator", scheduleId: "schedule-603", competencyIds: ["comp-post-12", "comp-post-21"] }),
        demoEmployee({ id: "emp-eli", name: "Eli Foster", role: "Coordinator", scheduleId: "schedule-603", competencyIds: ["comp-dock-2", "comp-dock-9"] }),
        demoEmployee({ id: "emp-maia", name: "Maia Chen", role: "QA Tech", scheduleId: "schedule-603", competencyIds: ["comp-pack-6", "comp-pack-9"] }),
        demoEmployee({ id: "emp-rina", name: "Rina Das", role: "Utility Relief", scheduleId: "schedule-603", competencyIds: ["comp-post-11", "comp-post-12", "comp-post-21"] }),
        demoEmployee({ id: "emp-iris", name: "Iris Bennett", role: "Dispatch Operator", scheduleId: "schedule-603", competencyIds: ["comp-dock-7", "comp-dock-9"] }),
        demoEmployee({ id: "emp-gia", name: "Gia Turner", role: "Packaging Tech", scheduleId: "schedule-603", competencyIds: ["comp-pack-3", "comp-pack-6", "comp-pack-9"] }),
      ],
    },
    {
      id: "schedule-604",
      name: "604",
      startDate: "2026-01-10",
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employees: [
        demoEmployee({ id: "emp-mika", name: "Mika Stone", role: "Operator", scheduleId: "schedule-604", competencyIds: ["comp-post-1", "comp-post-12"] }),
        demoEmployee({ id: "emp-zara", name: "Zara Shah", role: "Relief Operator", scheduleId: "schedule-604", competencyIds: ["comp-dock-2", "comp-dock-7", "comp-dock-9"] }),
        demoEmployee({ id: "emp-rhett", name: "Rhett Cole", role: "Forklift Operator", scheduleId: "schedule-604", competencyIds: ["comp-pack-3", "comp-pack-6"] }),
        demoEmployee({ id: "emp-teo", name: "Teo Ramirez", role: "Operator", scheduleId: "schedule-604", competencyIds: ["comp-post-1", "comp-post-12"] }),
        demoEmployee({ id: "emp-omar", name: "Omar Vega", role: "Release Specialist", scheduleId: "schedule-604", competencyIds: ["comp-dock-2", "comp-dock-7"] }),
        demoEmployee({ id: "emp-leo", name: "Leo Morris", role: "Inventory Relief", scheduleId: "schedule-604", competencyIds: ["comp-pack-6"] }),
      ],
    },
  ],
  assignments: [],
  projectedAssignments: [],
  overtimeClaims: [],
  manualOvertimePostings: [],
  completedSets: [],
  subSchedules: [],
  subScheduleAssignments: [],
};
