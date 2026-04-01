import type { AppRole, AppSession } from "@/lib/types";

export type DemoAccount = AppSession & {
  roleTitle: string;
  helperText: string;
};

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "admin@shiftcanvas.demo",
    role: "admin",
    roleTitle: "Admin",
    helperText: "Full access to shifts, competencies, time codes, personnel, overtime, and schedule controls.",
    displayName: "Morgan Admin",
    scheduleId: null,
    employeeId: null,
    scheduleName: null,
  },
  {
    email: "leader@shiftcanvas.demo",
    role: "leader",
    roleTitle: "Leader",
    helperText: "Assigned to Shift 1 with access to schedule and personnel changes for that shift.",
    displayName: "Jordan Leader",
    scheduleId: "schedule-601",
    employeeId: null,
    scheduleName: "1",
  },
  {
    email: "worker@shiftcanvas.demo",
    role: "worker",
    roleTitle: "Worker",
    helperText: "Read-only schedule access plus a personal worker profile.",
    displayName: "Ava Patel",
    scheduleId: "schedule-601",
    employeeId: "emp-ava",
    scheduleName: "1",
  },
];

function titleCaseFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? "";

  return localPart
    .split(/[.\-_+]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function getDemoAccounts() {
  return DEMO_ACCOUNTS;
}

export function getDemoAccountByEmail(email: string) {
  return DEMO_ACCOUNTS.find((account) => account.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
}

export function buildDemoSession(email: string, role: AppRole) {
  const template = DEMO_ACCOUNTS.find((account) => account.role === role);

  if (!template) {
    return null;
  }

  return {
    ...template,
    email: email.trim().toLowerCase(),
    displayName: role === "worker" ? template.displayName : titleCaseFromEmail(email) || template.displayName,
  } satisfies AppSession;
}
