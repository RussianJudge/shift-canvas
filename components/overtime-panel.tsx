"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { claimOvertimePosting, releaseOvertimePosting } from "@/app/actions";
import {
  buildAssignmentIndex,
  createSetRangeKey,
  createSetRangeKeyFromEntry,
  getEmployeeMap,
  getExtendedMonthDays,
  getMonthDays,
  getScheduleById,
  getWorkedSetDays,
  shiftForDate,
} from "@/lib/scheduling";
import type { Employee, SchedulerSnapshot, ShiftKind } from "@/lib/types";

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

function getWorkedSets(
  schedule: SchedulerSnapshot["schedules"][number],
  monthDays: Array<{ date: string }>,
  extendedMonthDays: Array<{ date: string }>,
) {
  const sets: Array<{
    dates: string[];
    segments: Array<{ shiftKind: Exclude<ShiftKind, "OFF">; dates: string[] }>;
  }> = [];
  const processedKeys = new Set<string>();

  for (const day of monthDays) {
    if (shiftForDate(schedule, day.date) === "OFF") {
      continue;
    }

    const setDays = getWorkedSetDays(schedule, extendedMonthDays, day.date);

    if (setDays.length === 0) {
      continue;
    }

    const setKey = `${setDays[0].date}:${setDays[setDays.length - 1].date}`;

    if (processedKeys.has(setKey)) {
      continue;
    }

    processedKeys.add(setKey);

    const segments = setDays.reduce<Array<{ shiftKind: Exclude<ShiftKind, "OFF">; dates: string[] }>>(
      (currentSegments, setDay) => {
        const shiftKind = shiftForDate(schedule, setDay.date);

        if (shiftKind === "OFF") {
          return currentSegments;
        }

        const currentSegment = currentSegments[currentSegments.length - 1];

        if (!currentSegment || currentSegment.shiftKind !== shiftKind) {
          currentSegments.push({
            shiftKind,
            dates: [setDay.date],
          });
          return currentSegments;
        }

        currentSegment.dates.push(setDay.date);
        return currentSegments;
      },
      [],
    );

    sets.push({
      dates: setDays.map((setDay) => setDay.date),
      segments,
    });
  }

  return sets;
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

function getClaimStatus(
  employee: Employee | null,
  posting: OvertimePosting,
  snapshot: SchedulerSnapshot,
  assignments: Record<string, { competencyId: string | null; timeCodeId: string | null }>,
) {
  if (!employee) {
    return { canClaim: false, reason: "Select an employee first." };
  }

  if (!employee.competencyIds.includes(posting.competencyId)) {
    return { canClaim: false, reason: "Employee is not qualified for this post." };
  }

  const employeeSchedule = getScheduleById(snapshot, employee.scheduleId);

  for (const date of posting.dates) {
    if (shiftForDate(employeeSchedule, date) !== "OFF") {
      return { canClaim: false, reason: "Posting falls on this employee's regular shift." };
    }

    const selection = getCellSelection(employee, date, assignments);

    if (selection.competencyId || selection.timeCodeId) {
      return { canClaim: false, reason: "Employee already has an assignment on one or more posting dates." };
    }
  }

  return { canClaim: true, reason: "Available to claim." };
}

export function OvertimePanel({
  snapshot,
  availableMonths,
}: {
  snapshot: SchedulerSnapshot;
  availableMonths: string[];
}) {
  const router = useRouter();
  const [claimingEmployeeId, setClaimingEmployeeId] = useState(
    snapshot.schedules.flatMap((schedule) => schedule.employees).sort((left, right) => left.name.localeCompare(right.name))[0]?.id ?? "",
  );
  const [selectedScheduleFilter, setSelectedScheduleFilter] = useState("all");
  const [selectedCompetencyFilter, setSelectedCompetencyFilter] = useState("all");
  const [statusMessage, setStatusMessage] = useState("");
  const [isClaiming, startClaimTransition] = useTransition();

  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const assignmentIndex = useMemo(() => buildAssignmentIndex(snapshot.assignments), [snapshot.assignments]);
  const monthDays = useMemo(() => getMonthDays(snapshot.month), [snapshot.month]);
  const extendedMonthDays = useMemo(() => getExtendedMonthDays(snapshot.month), [snapshot.month]);
  const completedSetRangeKeys = useMemo(
    () => new Set(snapshot.completedSets.map(createSetRangeKeyFromEntry)),
    [snapshot.completedSets],
  );
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
      const workedSets = getWorkedSets(schedule, monthDays, extendedMonthDays);

      for (const workedSet of workedSets) {
        const setKey = createSetRangeKey(
          schedule.id,
          workedSet.dates[0],
          workedSet.dates[workedSet.dates.length - 1],
        );

        if (!completedSetRangeKeys.has(setKey)) {
          continue;
        }

        for (const segment of workedSet.segments) {
          if (segment.dates[0]?.slice(0, 7) !== snapshot.month) {
            continue;
          }

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
            const filledCells =
              setDates.length * competency.requiredStaff -
              missingSlotsByDate.reduce((sum, value) => sum + value, 0);
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
                claimedBySelectedEmployee: true,
              });
            }

            for (let slotIndex = 0; slotIndex < maxMissing; slotIndex += 1) {
              const postingDates = setDates.filter((_, index) => missingSlotsByDate[index] > slotIndex);

              if (postingDates.length === 0) {
                continue;
              }

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
                claimedBySelectedEmployee: false,
              });
            }
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
  }, [
    assignmentIndex,
    claimingEmployeeId,
    completedSetRangeKeys,
    employeeMap,
    extendedMonthDays,
    monthDays,
    snapshot,
    snapshot.competencies,
    snapshot.month,
    snapshot.overtimeClaims,
    snapshot.schedules,
  ]);
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
  const groupedPostings = useMemo(
    () =>
      Object.values(
        filteredPostings.reduce<
          Record<string, { key: string; scheduleName: string; shiftKind: Exclude<ShiftKind, "OFF">; dates: string[]; postings: OvertimePosting[] }>
        >((groups, posting) => {
          const key = `${posting.scheduleId}:${posting.shiftKind}:${posting.dates[0]}:${posting.dates[posting.dates.length - 1]}`;
          groups[key] ??= {
            key,
            scheduleName: posting.scheduleName,
            shiftKind: posting.shiftKind,
            dates: posting.dates,
            postings: [],
          };
          groups[key].postings.push(posting);
          return groups;
        }, {}),
      ),
    [filteredPostings],
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
          <span>Month</span>
          <select
            value={snapshot.month}
            onChange={(event) => router.push(`/overtime?month=${event.target.value}`)}
          >
            {availableMonths.map((month) => (
              <option key={month} value={month}>
                {new Intl.DateTimeFormat("en-US", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${month}-01T00:00:00Z`))}
              </option>
            ))}
          </select>
        </label>

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

        <div className="toolbar-status-wrap">
          {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
        </div>
      </div>

      <div className="overtime-list">
        {groupedPostings.map((group) => (
          <section key={group.key} className="overtime-group">
            <div className="overtime-group__header">
              <div>
                <p className="overtime-card-team">Shift {group.scheduleName}</p>
                <h2 className="overtime-card-title">
                  {formatShortDate(group.dates[0])} - {formatShortDate(group.dates[group.dates.length - 1])}
                </h2>
              </div>
              <span className="overtime-group__meta">{getShiftLabel(group.shiftKind, group.dates.length)}</span>
            </div>

            <div className="overtime-group__cards">
              {group.postings.map((posting) => {
                const claimStatus = getClaimStatus(claimingEmployee, posting, snapshot, assignmentIndex);

                return (
                  <article
                    key={posting.id}
                    className={`overtime-card ${posting.claimedBySelectedEmployee ? "overtime-card--claimed" : ""}`}
                  >
                    <div className="overtime-card-top">
                      <div>
                        <p className="overtime-card-team">{posting.competencyCode}</p>
                        <h3 className="overtime-card-title">{posting.competencyLabel}</h3>
                      </div>
                      <span className={`legend-pill legend-pill--${posting.colorToken.toLowerCase()}`}>
                        {posting.competencyCode.replace("Post ", "")}
                      </span>
                    </div>

                    <div className="overtime-card-meta">
                      <span>{posting.openShifts} open shift{posting.openShifts === 1 ? "" : "s"}</span>
                      <span>{formatStaffCount(posting.staffedPeople)}/{posting.requiredStaff} staffed</span>
                    </div>

                    <div className="overtime-card-actions">
                      <span className="overtime-card-hint">
                        {posting.claimedBySelectedEmployee ? "Claimed by selected employee" : claimStatus.reason}
                      </span>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => (posting.claimedBySelectedEmployee ? handleRelease(posting) : handleClaim(posting))}
                        disabled={isClaiming || (!posting.claimedBySelectedEmployee && !claimStatus.canClaim)}
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
            </div>
          </section>
        ))}

        {groupedPostings.length === 0 ? (
          <div className="empty-state">
            <strong>No overtime postings.</strong>
            <span>Complete a set on the Schedule page, or all completed sets are fully staffed.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
