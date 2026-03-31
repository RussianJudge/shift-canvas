"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { claimOvertimePosting, releaseOvertimePosting } from "@/app/actions";
import {
  buildAssignmentIndex,
  getCompetencyMap,
  getEmployeeMap,
  getMonthDays,
  getScheduleById,
  shiftForDate,
} from "@/lib/scheduling";
import type { Competency, Employee, SchedulerSnapshot, ShiftKind } from "@/lib/types";

type OvertimePosting = {
  id: string;
  scheduleId: string;
  scheduleName: string;
  shiftKind: Exclude<ShiftKind, "OFF">;
  competencyId: string;
  competencyCode: string;
  competencyLabel: string;
  colorToken: string;
  dates: string[];
  staffedPeople: number;
  requiredStaff: number;
  openShifts: number;
  eligibleEmployeeIds: string[];
  claimedBySelectedEmployee: boolean;
};

function formatShortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatStaffCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getShiftLabel(shiftKind: Exclude<ShiftKind, "OFF">, count: number) {
  return `${count} ${shiftKind === "DAY" ? "day" : "night"} shift${count === 1 ? "" : "s"}`;
}

function getWorkedSegments(schedule: SchedulerSnapshot["schedules"][number], monthDays: Array<{ date: string }>) {
  const segments: Array<{ shiftKind: Exclude<ShiftKind, "OFF">; dates: string[] }> = [];
  let currentSegment: { shiftKind: Exclude<ShiftKind, "OFF">; dates: string[] } | null = null;

  for (const day of monthDays) {
    const shiftKind = shiftForDate(schedule, day.date);

    if (shiftKind === "OFF") {
      if (currentSegment) {
        segments.push(currentSegment);
        currentSegment = null;
      }

      continue;
    }

    if (!currentSegment || currentSegment.shiftKind !== shiftKind) {
      if (currentSegment) {
        segments.push(currentSegment);
      }

      currentSegment = {
        shiftKind,
        dates: [day.date],
      };
      continue;
    }

    currentSegment.dates.push(day.date);
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

function getCellSelection(
  employee: Employee,
  date: string,
  assignments: Record<string, { competencyId: string | null; timeCodeId: string | null }>,
) {
  return assignments[`${employee.id}:${date}`] ?? {
    competencyId: null,
    timeCodeId: null,
  };
}

function isEmployeeAvailableForDates(
  employee: Employee,
  schedule: SchedulerSnapshot["schedules"][number],
  dates: string[],
  assignments: Record<string, { competencyId: string | null; timeCodeId: string | null }>,
) {
  return dates.every((date) => {
    const shiftKind = shiftForDate(schedule, date);
    const selection = getCellSelection(employee, date, assignments);

    return shiftKind === "OFF" && !selection.competencyId && !selection.timeCodeId;
  });
}

export function OvertimePanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const router = useRouter();
  const [claimingEmployeeId, setClaimingEmployeeId] = useState(
    snapshot.schedules.flatMap((schedule) => schedule.employees).sort((left, right) => left.name.localeCompare(right.name))[0]?.id ?? "",
  );
  const [selectedScheduleFilter, setSelectedScheduleFilter] = useState("all");
  const [selectedCompetencyFilter, setSelectedCompetencyFilter] = useState("all");
  const [statusMessage, setStatusMessage] = useState("");
  const [isClaiming, startClaimTransition] = useTransition();

  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const assignmentIndex = useMemo(() => buildAssignmentIndex(snapshot.assignments), [snapshot.assignments]);
  const monthDays = useMemo(() => getMonthDays(snapshot.month), [snapshot.month]);
  const allEmployees = useMemo(
    () =>
      snapshot.schedules
        .flatMap((schedule) => schedule.employees)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.schedules],
  );

  const postings = useMemo<OvertimePosting[]>(() => {
    const nextPostings: OvertimePosting[] = [];
    const selectedEmployeeClaims = snapshot.overtimeClaims.filter((claim) => claim.employeeId === claimingEmployeeId);

    for (const schedule of snapshot.schedules) {
      const workedSegments = getWorkedSegments(schedule, monthDays);

      for (const segment of workedSegments) {
        const setDates = segment.dates;

        for (const competency of snapshot.competencies) {
          const missingSlotsByDate = setDates.map((date) => {
            let filledCount = 0;

            for (const employee of schedule.employees) {
              const selection = getCellSelection(employee, date, assignmentIndex);

              if (selection.competencyId === competency.id) {
                filledCount += 1;
              }
            }

            for (const claim of snapshot.overtimeClaims) {
              const claimEmployee = employeeMap[claim.employeeId];

              if (
                claim.scheduleId === schedule.id &&
                claim.competencyId === competency.id &&
                claim.date === date &&
                claimEmployee?.scheduleId !== schedule.id
              ) {
                filledCount += 1;
              }
            }

            return Math.max(0, competency.requiredStaff - filledCount);
          });

          const maxMissing = Math.max(0, ...missingSlotsByDate);
          const filledCells = setDates.length * competency.requiredStaff - missingSlotsByDate.reduce((sum, value) => sum + value, 0);
          const staffedPeople = setDates.length > 0 ? filledCells / setDates.length : 0;
          const claimedDates = selectedEmployeeClaims
            .filter(
              (claim) =>
                claim.scheduleId === schedule.id &&
                claim.competencyId === competency.id &&
                setDates.includes(claim.date),
            )
            .map((claim) => claim.date)
            .sort();

          if (claimedDates.length > 0) {
            nextPostings.push({
              id: `claimed:${schedule.id}:${competency.id}:${claimedDates[0]}`,
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              shiftKind: segment.shiftKind,
              competencyId: competency.id,
              competencyCode: competency.code,
              competencyLabel: competency.label,
              colorToken: competency.colorToken,
              dates: claimedDates,
              staffedPeople,
              requiredStaff: competency.requiredStaff,
              openShifts: claimedDates.length,
              eligibleEmployeeIds: claimingEmployeeId ? [claimingEmployeeId] : [],
              claimedBySelectedEmployee: true,
            });
          }

          for (let slotIndex = 0; slotIndex < maxMissing; slotIndex += 1) {
            const postingDates = setDates.filter((_, index) => missingSlotsByDate[index] > slotIndex);

            if (postingDates.length === 0) {
              continue;
            }

            const eligibleEmployeeIds = allEmployees
              .filter((employee) => {
                if (!employee.competencyIds.includes(competency.id)) {
                  return false;
                }

                const employeeSchedule = getScheduleById(snapshot, employee.scheduleId);
                return isEmployeeAvailableForDates(employee, employeeSchedule, postingDates, assignmentIndex);
              })
              .map((employee) => employee.id);

            nextPostings.push({
              id: `${schedule.id}:${competency.id}:${postingDates[0]}:${slotIndex}`,
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              shiftKind: segment.shiftKind,
              competencyId: competency.id,
              competencyCode: competency.code,
              competencyLabel: competency.label,
              colorToken: competency.colorToken,
              dates: postingDates,
              staffedPeople,
              requiredStaff: competency.requiredStaff,
              openShifts: postingDates.length,
              eligibleEmployeeIds,
              claimedBySelectedEmployee: false,
            });
          }
        }
      }
    }

    return nextPostings.sort((left, right) =>
      Number(right.claimedBySelectedEmployee) - Number(left.claimedBySelectedEmployee) ||
      left.scheduleName.localeCompare(right.scheduleName) ||
      left.dates[0].localeCompare(right.dates[0]) ||
      left.shiftKind.localeCompare(right.shiftKind) ||
      left.competencyCode.localeCompare(right.competencyCode),
    );
  }, [allEmployees, assignmentIndex, claimingEmployeeId, employeeMap, monthDays, snapshot, snapshot.competencies, snapshot.overtimeClaims, snapshot.schedules]);
  const filteredPostings = useMemo(
    () =>
      postings.filter((posting) => {
        if (selectedScheduleFilter !== "all" && posting.scheduleId !== selectedScheduleFilter) {
          return false;
        }

        if (selectedCompetencyFilter !== "all" && posting.competencyId !== selectedCompetencyFilter) {
          return false;
        }

        return true;
      }),
    [postings, selectedCompetencyFilter, selectedScheduleFilter],
  );

  const claimingEmployee = claimingEmployeeId ? employeeMap[claimingEmployeeId] ?? null : null;

  function handleClaim(posting: OvertimePosting) {
    if (!claimingEmployeeId) {
      setStatusMessage("Select an employee first.");
      return;
    }

    startClaimTransition(async () => {
      const result = await claimOvertimePosting({
        scheduleId: posting.scheduleId,
        employeeId: claimingEmployeeId,
        competencyId: posting.competencyId,
        dates: posting.dates,
      });

      setStatusMessage(result.message);

      if (result.ok) {
        router.refresh();
      }
    });
  }

  function handleRelease(posting: OvertimePosting) {
    if (!claimingEmployeeId) {
      setStatusMessage("Select an employee first.");
      return;
    }

    startClaimTransition(async () => {
      const result = await releaseOvertimePosting({
        scheduleId: posting.scheduleId,
        employeeId: claimingEmployeeId,
        competencyId: posting.competencyId,
        dates: posting.dates,
      });

      setStatusMessage(result.message);

      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Overtime</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--overtime">
        <label className="field">
          <span>Claim As</span>
          <select
            value={claimingEmployeeId}
            onChange={(event) => setClaimingEmployeeId(event.target.value)}
          >
            {allEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Team</span>
          <select
            value={selectedScheduleFilter}
            onChange={(event) => setSelectedScheduleFilter(event.target.value)}
          >
            <option value="all">All teams</option>
            {snapshot.schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Competency</span>
          <select
            value={selectedCompetencyFilter}
            onChange={(event) => setSelectedCompetencyFilter(event.target.value)}
          >
            <option value="all">All competencies</option>
            {snapshot.competencies.map((competency) => (
              <option key={competency.id} value={competency.id}>
                {competency.code}
              </option>
            ))}
          </select>
        </label>

        <div className="workspace-copy workspace-copy--full">
          <strong>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${snapshot.month}-01T00:00:00Z`))}</strong>
          <p>
            {claimingEmployee
              ? `${claimingEmployee.name} can claim any posting they are qualified for and free to cover.`
              : "Select an employee to claim a posting."}
          </p>
        </div>

        <div className="toolbar-status-wrap">
          {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
        </div>
      </div>

      <div className="overtime-list">
        {filteredPostings.map((posting) => {
          const canClaim = claimingEmployeeId ? posting.eligibleEmployeeIds.includes(claimingEmployeeId) : false;

          return (
            <article
              key={posting.id}
              className={`overtime-card ${posting.claimedBySelectedEmployee ? "overtime-card--claimed" : ""}`}
            >
              <div className="overtime-card-top">
                <div>
                  <p className="overtime-card-team">Shift {posting.scheduleName}</p>
                  <h2 className="overtime-card-title">{posting.competencyLabel}</h2>
                </div>
                <span className={`legend-pill legend-pill--${posting.colorToken.toLowerCase()}`}>
                  {posting.competencyCode.replace("Post ", "")}
                </span>
              </div>

              <div className="overtime-card-meta">
                <span>{formatShortDate(posting.dates[0])} - {formatShortDate(posting.dates[posting.dates.length - 1])}</span>
                <span>{getShiftLabel(posting.shiftKind, posting.dates.length)}</span>
                <span>{posting.openShifts} open shift{posting.openShifts === 1 ? "" : "s"}</span>
                <span>{formatStaffCount(posting.staffedPeople)}/{posting.requiredStaff} staffed</span>
              </div>

              <div className="overtime-card-actions">
                <span className="overtime-card-hint">
                  {posting.claimedBySelectedEmployee
                    ? "Claimed by selected employee"
                    : posting.eligibleEmployeeIds.length > 0
                    ? `${posting.eligibleEmployeeIds.length} employee${posting.eligibleEmployeeIds.length === 1 ? "" : "s"} can claim`
                    : "No eligible employees available"}
                </span>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => (posting.claimedBySelectedEmployee ? handleRelease(posting) : handleClaim(posting))}
                  disabled={isClaiming || (!posting.claimedBySelectedEmployee && !canClaim)}
                >
                  {isClaiming
                    ? posting.claimedBySelectedEmployee
                      ? "Releasing..."
                      : "Claiming..."
                    : posting.claimedBySelectedEmployee
                    ? "Release Posting"
                    : "Claim Posting"}
                </button>
              </div>
            </article>
          );
        })}

        {filteredPostings.length === 0 ? (
          <div className="empty-state">
            <strong>No overtime postings.</strong>
            <span>Try a different team or competency filter, or all current sets are fully staffed.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
