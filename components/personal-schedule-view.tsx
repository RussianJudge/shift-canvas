"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { AppDateSelector } from "@/components/app-date-selector";
import { PersonalAssignmentRow, PersonalRestRow } from "@/components/personal-assignment-row";
import { PersonalCalendar } from "@/components/personal-calendar";
import { PersonalDayStrip } from "@/components/personal-day-strip";
import { PersonalScheduleEmptyState } from "@/components/personal-schedule-empty-state";
import { UpcomingAssignments } from "@/components/upcoming-assignments";
import {
  buildPersonalMonth,
  buildUpcomingAssignments,
  findNextAssignment,
  formatPersonalDate,
  formatRelativeDay,
} from "@/lib/personal-schedule";
import { buildScheduleScopeHref } from "@/lib/schedule-scope";
import { getWeeksForMonth } from "@/lib/scheduling";
import { useBusinessToday } from "@/lib/use-business-today";
import type { Competency, StoredAssignment, TimeCode } from "@/lib/types";

/**
 * The signed-in employee's own schedule.
 *
 * Read-only by design: editing stays on the team grid, which owns the drag
 * select, the autosave and the permission checks. This view re-reads the same
 * snapshot rows the grid renders, so a sub-schedule day or a day worked on
 * another crew appears here the moment it appears there.
 */
export function PersonalScheduleView({
  employeeId,
  scheduleId,
  month,
  assignments,
  projectedAssignments,
  competencies,
  timeCodes,
  location,
  canViewTeam,
  scopeToggle,
  scheduleParam,
  initialToday,
}: {
  employeeId: string | null;
  scheduleId: string;
  month: string;
  assignments: StoredAssignment[];
  projectedAssignments: StoredAssignment[];
  competencies: Competency[];
  timeCodes: TimeCode[];
  location: string | null;
  canViewTeam: boolean;
  scopeToggle: ReactNode;
  /** Carried across a month change so the context survives the navigation. */
  scheduleParam: string | null;
  /** Resolved on the server so the first paint already lands on today. */
  initialToday: string;
}) {
  const router = useRouter();
  // The hook returns null until mount and then wins, so a page left open
  // across midnight still moves on.
  const businessToday = useBusinessToday() ?? initialToday;
  const weeks = useMemo(() => getWeeksForMonth(month), [month]);
  const gridDays = useMemo(() => weeks.flatMap((week) => week.days), [weeks]);
  const days = useMemo(
    () =>
      employeeId
        ? buildPersonalMonth({
            employeeId,
            scheduleId,
            monthDays: gridDays,
            assignments,
            projectedAssignments,
            competencies,
            timeCodes,
          })
        : [],
    [assignments, competencies, employeeId, gridDays, projectedAssignments, scheduleId, timeCodes],
  );
  const daysByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  /**
   * Today when the month contains it, otherwise the first of the month being
   * looked at — paging to a month and landing on a date outside it would leave
   * the day list showing nothing.
   */
  const fallbackDate = `${month}-01`;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const resolvedSelectedDate =
    selectedDate && selectedDate.slice(0, 7) === month
      ? selectedDate
      : businessToday && businessToday.slice(0, 7) === month
        ? businessToday
        : fallbackDate;

  const anchorDate = businessToday ?? fallbackDate;
  const nextAssignment = useMemo(() => findNextAssignment(days, anchorDate), [anchorDate, days]);
  const upcoming = useMemo(
    () => buildUpcomingAssignments({ days, fromDate: nextAssignment?.date ?? anchorDate }),
    [anchorDate, days, nextAssignment],
  );
  const selectedDay = daysByDate.get(resolvedSelectedDate) ?? null;
  const stripDays = useMemo(() => {
    const index = days.findIndex((day) => day.date === resolvedSelectedDate);

    if (index === -1) {
      return days.slice(0, 7);
    }

    const start = Math.max(0, Math.min(index - 1, days.length - 7));
    return days.slice(start, start + 7);
  }, [days, resolvedSelectedDate]);

  return (
    <section className="panel-frame personal-schedule">
      <header className="personal-schedule__header">
        <div>
          <h1 className="personal-schedule__title">Schedule</h1>
          <nav aria-label="Breadcrumb" className="personal-schedule__breadcrumb">
            <span>Workforce</span>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Schedule</span>
          </nav>
        </div>

        <div className="personal-schedule__controls">
          {/* No schedule selector here: My schedule is the viewer's own crew,
              so there is nothing for it to choose between. */}
          {scopeToggle}
        </div>
      </header>

      {employeeId ? (
        <>
          <div className="personal-schedule__toolbar">
            <AppDateSelector
              mode="month"
              value={month}
              label="Schedule month"
              onChange={(nextMonth) =>
                router.push(
                  buildScheduleScopeHref({ scope: "mine", month: nextMonth, schedule: scheduleParam }),
                )
              }
            />
          </div>

          <div className="personal-schedule__body">
            <div className="personal-schedule__main">
              <PersonalCalendar
                weeks={weeks}
                daysByDate={daysByDate}
                today={businessToday}
                selectedDate={resolvedSelectedDate}
                onSelectDate={setSelectedDate}
              />

              <div className="personal-schedule__mobile">
                <PersonalDayStrip
                  days={stripDays}
                  today={businessToday}
                  selectedDate={resolvedSelectedDate}
                  onSelectDate={setSelectedDate}
                />

                <h2 className="personal-schedule__day-heading">
                  {formatPersonalDate(resolvedSelectedDate)}
                </h2>

                {selectedDay?.isWorking ? (
                  <PersonalAssignmentRow day={selectedDay} location={location} />
                ) : selectedDay ? (
                  <PersonalRestRow day={selectedDay} />
                ) : null}
              </div>
            </div>

            <aside className="personal-schedule__aside" aria-label="What is coming up">
              <section className="personal-next">
                <div className="personal-next__heading">
                  <h2 className="personal-next__eyebrow">Next assignment</h2>
                  {nextAssignment ? (
                    <span className="personal-next__when">
                      {formatRelativeDay(nextAssignment.date, anchorDate) ?? "Upcoming"}
                    </span>
                  ) : null}
                </div>

                {nextAssignment ? (
                  <>
                    <p className="personal-next__date">{formatPersonalDate(nextAssignment.date)}</p>
                    <PersonalAssignmentRow day={nextAssignment} location={location} />
                  </>
                ) : (
                  <p className="personal-next__none">No further shifts scheduled this month.</p>
                )}
              </section>

              <section className="personal-upcoming">
                <div className="personal-upcoming__heading">
                  <h2 className="personal-upcoming__title">Coming up</h2>
                  <span className="personal-upcoming__scope">This month</span>
                </div>
                <UpcomingAssignments entries={upcoming} />
              </section>

              <p className="personal-schedule__note">
                Schedule details shown from current assignment data.
              </p>
            </aside>
          </div>
        </>
      ) : (
        <PersonalScheduleEmptyState canViewTeam={canViewTeam} />
      )}
    </section>
  );
}
