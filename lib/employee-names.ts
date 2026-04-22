/**
 * Shared employee-name helpers.
 *
 * The database stores employee names as separate first and last name columns,
 * while several screens still prefer to show a compact `Last, First` label.
 * Keeping the split/format rules here prevents each page from inventing its
 * own slightly different interpretation of a worker's name.
 */

export type EmployeeNameParts = {
  firstName: string;
  lastName: string;
};

/**
 * Splits a display name into database-ready first and last name fields.
 *
 * The expected operator import format is `Last, First`, so comma-delimited
 * names are treated as authoritative. A small space-delimited fallback keeps
 * manual entries like `Ava Patel` usable during editing and seed data resets.
 */
export function splitEmployeeDisplayName(displayName: string): EmployeeNameParts {
  const trimmedName = displayName.trim();
  const delimiterIndex = trimmedName.indexOf(",");

  if (delimiterIndex >= 0) {
    return {
      lastName: trimmedName.slice(0, delimiterIndex).trim(),
      firstName: trimmedName.slice(delimiterIndex + 1).trim(),
    };
  }

  const nameParts = trimmedName.split(/\s+/).filter(Boolean);

  if (nameParts.length <= 1) {
    return {
      firstName: trimmedName,
      lastName: "",
    };
  }

  return {
    firstName: nameParts.slice(0, -1).join(" "),
    lastName: nameParts.at(-1) ?? "",
  };
}

/**
 * Formats split database fields into the display label used by the scheduler.
 *
 * When both fields are present we intentionally use `Last, First`, matching the
 * legacy `full_name` convention. If one side is blank, returning the available
 * value is friendlier than showing extra punctuation.
 */
export function formatEmployeeDisplayName(nameParts: EmployeeNameParts) {
  const firstName = nameParts.firstName.trim();
  const lastName = nameParts.lastName.trim();

  if (firstName && lastName) {
    return `${lastName}, ${firstName}`;
  }

  return lastName || firstName || "Unnamed employee";
}
