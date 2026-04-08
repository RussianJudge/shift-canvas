"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import type { AppSession, Employee, SchedulerSnapshot, ShiftKind } from "@/lib/types";

/**
 * Overtime board for packaging shortages into claimable postings.
 *
 * The board works from completed sets only. Each posting can either represent:
 * - a direct claim for the missing competency, or
 * - a swap path where the claimant takes one post and an on-team worker slides
 *   into the originally missing post.
 */
type OvertimePosting = {
  id: string;
  scheduleId: string;
  scheduleName: string;
  shiftKind: Exclude<ShiftKind, "OFF">;
  competencyId: string;
  competencyCode: string;
  competencyLabel: string;
  coverageCompetencyId: string;
  coverageCompetencyCode: string;
  coverageCompetencyLabel: string;
  colorToken: string;
  dates: string[];
  staffedPeople: number;
  requiredStaff: number;
  openShifts: number;
  claimedEmployeeId: string | null;
  claimedByName: string | null;
  swapEmployeeId: string | null;
  swapEmployeeName: string | null;
};

type AssignmentMeta = {
  coverageCompetencyId: string | null;
  swapEmployeeId: string | null;
  originalCompetencyId: string | null;
};

/** Parses overtime note metadata off assignment rows for claimed postings. */
function parseAssignmentMeta(note: string | null | undefined): AssignmentMeta {
  if (!note?.startsWith("OT|")) {
    return {
      coverageCompetencyId: null,
      swapEmployeeId: null,
      originalCompetencyId: null,
    };
  }

  const parts = note.split("|").slice(1);
  const values = new Map(
    parts.map((part) => {
      const [key, value] = part.split(":");
      return [key, value ?? ""];
    }),
  );

  return {
    coverageCompetencyId: values.get("coverage") || null,
    swapEmployeeId: values.get("swap") || null,
    originalCompetencyId: values.get("orig") || null,
  };
}

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

/** Groups a schedule's month into worked sets and their day/night segments. */
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
  // Workers can only claim OT that sits on their scheduled days off and does not
  // conflict with any existing assignment already on the calendar.
  if (!employee) {
    return { canClaim: false, reason: "Select an employee first." };
  }

  if (posting.claimedEmployeeId === employee.id) {
    return { canClaim: true, reason: "You already claimed this posting." };
  }

  if (!employee.competencyIds.includes(posting.competencyId)) {
    return { canClaim: false, reason: "Employee is not qualified for this post." };
  }

  const employeeSchedule = getScheduleById(snapshot, employee.scheduleId);

  for (const date of posting.dates) {
    const selection = getCellSelection(employee, date, assignments);

    if (selection.competencyId || selection.timeCodeId) {
      return { canClaim: false, reason: "Employee already has an assignment on one or more posting dates." };
    }

    if (shiftForDate(employeeSchedule, date) !== "OFF") {
      return { canClaim: false, reason: "Posting falls on this employee's regular shift." };
    }
  }

  return { canClaim: true, reason: "Available to claim." };
}

export function OvertimePanel({
  snapshot,
  availableMonths,
  viewer,
}: {
  snapshot: SchedulerSnapshot;
  availableMonths: string[];
  viewer: AppSession;
}) {
  // The board is built from snapshot state only; claiming/releasing triggers a
  // server refresh instead of trying to locally simulate every OT side effect.
  const router = useRouter();
  const [claimingEmployeeId, setClaimingEmployeeId] = useState(
    viewer.role === "worker"
      ? viewer.employeeId ?? ""
      : snapshot.schedules.flatMap((schedule) => schedule.employees).sort((left, right) => left.name.localeCompare(right.name))[0]?.id ?? "",
  );
  const [selectedScheduleFilter, setSelectedScheduleFilter] = useState("all");
  const [selectedCompetencyFilter, setSelectedCompetencyFilter] = useState("all");
  const [selectedPostingByGroup, setSelectedPostingByGroup] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [isClaiming, startClaimTransition] = useTransition();

  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const assignmentIndex = useMemo(() => buildAssignmentIndex(snapshot.assignments), [snapshot.assignments]);
  const assignmentMetaIndex = useMemo(
    () =>
      snapshot.assignments.reduce<Record<string, AssignmentMeta>>((map, assignment) => {
        map[`${assignment.employeeId}:${assignment.date}`] = parseAssignmentMeta(assignment.notes);
        return map;
      }, {}),
    [snapshot.assignments],
  );
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

  useEffect(() => {
    setClaimingEmployeeId((current) => {
      if (viewer.role === "worker") {
        return viewer.employeeId ?? "";
      }

      return allEmployees.some((employee) => employee.id === current) ? current : allEmployees[0]?.id ?? "";
    });
    setSelectedScheduleFilter((current) =>
      current === "all" || snapshot.schedules.some((schedule) => schedule.id === current) ? current : "all",
    );
    setSelectedCompetencyFilter((current) =>
      current === "all" || snapshot.competencies.some((competency) => competency.id === current) ? current : "all",
    );
    setSelectedPostingByGroup({});
    setStatusMessage("");
  }, [allEmployees, snapshot.competencies, snapshot.schedules, viewer.employeeId, viewer.role]);

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

            const claimDatesByEmployee = snapshot.overtimeClaims.reduce<Record<string, string[]>>((map, claim) => {
              if (
                claim.scheduleId === schedule.id &&
                claim.competencyId === competency.id &&
                setDates.includes(claim.date)
              ) {
                map[claim.employeeId] ??= [];
                map[claim.employeeId].push(claim.date);
              }

              return map;
            }, {});

            for (const [employeeId, employeeDates] of Object.entries(claimDatesByEmployee)) {
              const orderedDates = setDates.filter((date) => employeeDates.includes(date));
              const claimEmployee = employeeMap[employeeId];
              const assignmentMeta = orderedDates[0]
                ? assignmentMetaIndex[`${employeeId}:${orderedDates[0]}`]
                : undefined;
              const coverageCompetencyId = assignmentMeta?.coverageCompetencyId ?? competency.id;
              const coverageCompetency = snapshot.competencies.find((entry) => entry.id === coverageCompetencyId);
              const swapEmployeeId = assignmentMeta?.swapEmployeeId ?? null;
              const swapEmployee = swapEmployeeId ? employeeMap[swapEmployeeId] : null;
              let currentRun: string[] = [];

              const flushRun = () => {
                if (currentRun.length === 0) {
                  return;
                }

                nextPostings.push({
                  id: `claimed:${schedule.id}:${competency.id}:${employeeId}:${currentRun[0]}`,
                  scheduleId: schedule.id,
                  scheduleName: schedule.name,
                  shiftKind: segment.shiftKind,
                  competencyId: competency.id,
                  competencyCode: competency.code,
                  competencyLabel: competency.label,
                  coverageCompetencyId,
                  coverageCompetencyCode: coverageCompetency?.code ?? competency.code,
                  coverageCompetencyLabel: coverageCompetency?.label ?? competency.label,
                  colorToken: competency.colorToken,
                  dates: [...currentRun],
                  staffedPeople,
                  requiredStaff: competency.requiredStaff,
                  openShifts: currentRun.length,
                  claimedEmployeeId: employeeId,
                  claimedByName: claimEmployee?.name ?? "Unknown worker",
                  swapEmployeeId,
                  swapEmployeeName: swapEmployee?.name ?? null,
                });
                currentRun = [];
              };

              for (let index = 0; index < orderedDates.length; index += 1) {
                const date = orderedDates[index];
                const previousDate = orderedDates[index - 1];
                const currentDateIndex = setDates.indexOf(date);
                const previousDateIndex = previousDate ? setDates.indexOf(previousDate) : -1;

                if (previousDate && currentDateIndex !== previousDateIndex + 1) {
                  flushRun();
                }

                currentRun.push(date);
              }

              flushRun();
            }

            for (let slotIndex = 0; slotIndex < maxMissing; slotIndex += 1) {
              const postingDates = setDates.filter((_, index) => missingSlotsByDate[index] > slotIndex);

              if (postingDates.length === 0) {
                continue;
              }
              const swapCandidates = schedule.employees.reduce<
                Record<string, { employeeId: string; employeeName: string; competencyId: string }>
              >((map, teamEmployee) => {
                if (!teamEmployee.competencyIds.includes(competency.id)) {
                  return map;
                }

                const assignedCompetencyIds = postingDates.reduce<string[]>((ids, date) => {
                  const selection = getCellSelection(teamEmployee, date, assignmentIndex);

                  if (selection.competencyId) {
                    ids.push(selection.competencyId);
                  }

                  return ids;
                }, []);

                if (assignedCompetencyIds.length !== postingDates.length) {
                  return map;
                }

                const offeredCompetencyId = assignedCompetencyIds[0];

                if (
                  !offeredCompetencyId ||
                  offeredCompetencyId === competency.id ||
                  assignedCompetencyIds.some((assignedCompetencyId) => assignedCompetencyId !== offeredCompetencyId)
                ) {
                  return map;
                }

                if (map[offeredCompetencyId]) {
                  return map;
                }

                map[offeredCompetencyId] = {
                  employeeId: teamEmployee.id,
                  employeeName: teamEmployee.name,
                  competencyId: offeredCompetencyId,
                };

                return map;
              }, {});

              const candidateEntries = Object.values(swapCandidates);

              nextPostings.push({
                id: `${schedule.id}:${competency.id}:${postingDates[0]}:${slotIndex}`,
                scheduleId: schedule.id,
                scheduleName: schedule.name,
                shiftKind: segment.shiftKind,
                competencyId: competency.id,
                competencyCode: competency.code,
                competencyLabel: competency.label,
                coverageCompetencyId: competency.id,
                coverageCompetencyCode: competency.code,
                coverageCompetencyLabel: competency.label,
                colorToken: competency.colorToken,
                dates: postingDates,
                staffedPeople,
                requiredStaff: competency.requiredStaff,
                openShifts: postingDates.length,
                claimedEmployeeId: null,
                claimedByName: null,
                swapEmployeeId: null,
                swapEmployeeName: null,
              });

              for (const candidate of candidateEntries) {
                const offeredCompetency = snapshot.competencies.find((entry) => entry.id === candidate.competencyId);

                if (!offeredCompetency) {
                  continue;
                }

                nextPostings.push({
                  id: `${schedule.id}:${candidate.competencyId}:${competency.id}:${postingDates[0]}:${slotIndex}:swap`,
                  scheduleId: schedule.id,
                  scheduleName: schedule.name,
                  shiftKind: segment.shiftKind,
                  competencyId: candidate.competencyId,
                  competencyCode: offeredCompetency.code,
                  competencyLabel: offeredCompetency.label,
                  coverageCompetencyId: competency.id,
                  coverageCompetencyCode: competency.code,
                  coverageCompetencyLabel: competency.label,
                  colorToken: offeredCompetency.colorToken,
                  dates: postingDates,
                  staffedPeople,
                  requiredStaff: competency.requiredStaff,
                  openShifts: postingDates.length,
                  claimedEmployeeId: null,
                  claimedByName: null,
                  swapEmployeeId: candidate.employeeId,
                  swapEmployeeName: candidate.employeeName,
                });
              }
            }
          }
        }
      }
    }

    return nextPostings.sort((left, right) =>
      Number(Boolean(right.claimedEmployeeId)) - Number(Boolean(left.claimedEmployeeId)) ||
      left.scheduleName.localeCompare(right.scheduleName) ||
      left.dates[0].localeCompare(right.dates[0]) ||
      left.shiftKind.localeCompare(right.shiftKind) ||
      left.competencyCode.localeCompare(right.competencyCode) ||
      (left.claimedByName ?? "").localeCompare(right.claimedByName ?? ""),
    );
  }, [
    assignmentIndex,
    completedSetRangeKeys,
    employeeMap,
    extendedMonthDays,
    monthDays,
    assignmentMetaIndex,
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
        coverageCompetencyId: posting.coverageCompetencyId,
        swapEmployeeId: posting.swapEmployeeId,
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

        {viewer.role === "worker" ? (
          <div className="field field--static">
            <span>Claim As</span>
            <strong>{claimingEmployee?.name ?? viewer.displayName}</strong>
          </div>
        ) : (
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
        )}

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
          (() => {
            const selectedPosting =
              group.postings.find((posting) => posting.id === selectedPostingByGroup[group.key]) ??
              group.postings[0];
            const claimStatus = selectedPosting
              ? getClaimStatus(claimingEmployee, selectedPosting, snapshot, assignmentIndex)
              : { canClaim: false, reason: "No overtime posting selected." };

            return (
              <section key={group.key} className="overtime-group">
                <article
                  className={`overtime-card ${selectedPosting?.claimedEmployeeId ? "overtime-card--claimed" : ""}`}
                >
                  <div className="overtime-group__header">
                    <div>
                      <p className="overtime-card-team">Shift {group.scheduleName}</p>
                      <h2 className="overtime-card-title">
                        {formatShortDate(group.dates[0])} - {formatShortDate(group.dates[group.dates.length - 1])}
                      </h2>
                    </div>
                    <span className="overtime-group__meta">{getShiftLabel(group.shiftKind, group.dates.length)}</span>
                  </div>

                  <div className="overtime-option-pills">
                    {group.postings.map((posting) => (
                      <button
                        key={posting.id}
                        type="button"
                        className={`overtime-option-pill legend-pill legend-pill--${posting.colorToken.toLowerCase()} ${
                          selectedPosting?.id === posting.id ? "overtime-option-pill--active" : ""
                        } ${posting.claimedEmployeeId ? "overtime-option-pill--claimed" : ""}`}
                        onClick={() =>
                          setSelectedPostingByGroup((current) => ({
                            ...current,
                            [group.key]: posting.id,
                          }))
                        }
                      >
                        <strong>{posting.competencyCode.replace("Post ", "")}</strong>
                        <span>
                          {posting.coverageCompetencyId !== posting.competencyId
                            ? `fills ${posting.coverageCompetencyCode}`
                            : `${posting.openShifts} shift${posting.openShifts === 1 ? "" : "s"}`}
                        </span>
                      </button>
                    ))}
                  </div>

                  {selectedPosting ? (
                    <>
                      <div className="overtime-card-top">
                        <div>
                          <p className="overtime-card-team">
                            {selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                              ? `Needed ${selectedPosting.coverageCompetencyCode}`
                              : selectedPosting.competencyCode}
                          </p>
                          <h3 className="overtime-card-title">
                            {selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                              ? selectedPosting.coverageCompetencyLabel
                              : selectedPosting.competencyLabel}
                          </h3>
                        </div>
                        <span className={`legend-pill legend-pill--${selectedPosting.colorToken.toLowerCase()}`}>
                          {selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                            ? `${selectedPosting.competencyCode.replace("Post ", "")} -> ${selectedPosting.coverageCompetencyCode.replace("Post ", "")}`
                            : selectedPosting.competencyCode.replace("Post ", "")}
                        </span>
                      </div>

                      <div className="overtime-card-meta">
                        <span>
                          {selectedPosting.openShifts} open shift{selectedPosting.openShifts === 1 ? "" : "s"}
                        </span>
                        <span>{formatStaffCount(selectedPosting.staffedPeople)}/{selectedPosting.requiredStaff} staffed</span>
                      </div>

                      {selectedPosting.coverageCompetencyId !== selectedPosting.competencyId ? (
                        <div className="overtime-card-meta">
                          <span>
                            Claim {selectedPosting.competencyCode} to fill {selectedPosting.coverageCompetencyCode}
                            {selectedPosting.swapEmployeeName ? ` via ${selectedPosting.swapEmployeeName}` : " via swap"}
                          </span>
                        </div>
                      ) : null}

                      <div className="overtime-card-actions">
                        <span className="overtime-card-hint">
                          {selectedPosting.claimedByName
                            ? `Claimed by ${selectedPosting.claimedByName}${
                                selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                                  ? ` · resolves ${selectedPosting.coverageCompetencyCode}`
                                  : ""
                              }`
                            : claimStatus.reason}
                        </span>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() =>
                            selectedPosting.claimedEmployeeId === claimingEmployeeId
                              ? handleRelease(selectedPosting)
                              : handleClaim(selectedPosting)
                          }
                          disabled={
                            isClaiming ||
                            (selectedPosting.claimedEmployeeId !== null &&
                              selectedPosting.claimedEmployeeId !== claimingEmployeeId) ||
                            (selectedPosting.claimedEmployeeId === null && !claimStatus.canClaim)
                          }
                        >
                          {isClaiming
                            ? selectedPosting.claimedEmployeeId === claimingEmployeeId
                              ? "Releasing..."
                              : "Claiming..."
                            : selectedPosting.claimedEmployeeId === claimingEmployeeId
                            ? "Release Posting"
                            : selectedPosting.claimedEmployeeId
                            ? "Claimed"
                            : "Claim Posting"}
                        </button>
                      </div>
                    </>
                  ) : null}
                </article>
              </section>
            );
          })()
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
