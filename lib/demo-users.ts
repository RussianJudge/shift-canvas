import type { AppSession } from "@/lib/types";

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
    helperText: "Access to schedule, overtime, and personnel changes across all shifts.",
    displayName: "Jordan Leader",
    scheduleId: "schedule-601",
    employeeId: null,
    scheduleName: "1",
  },
  {
    email: "worker@shiftcanvas.demo",
    role: "worker",
    roleTitle: "Worker",
    helperText: "Can view all shifts, claim overtime as themselves, and manage their own profile.",
    displayName: "Ava Patel",
    scheduleId: "schedule-601",
    employeeId: "emp-ava",
    scheduleName: "1",
  },
];

export function getDemoAccounts() {
  return DEMO_ACCOUNTS;
}

export function getDemoAccountByEmail(email: string) {
  return DEMO_ACCOUNTS.find((account) => account.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
}
