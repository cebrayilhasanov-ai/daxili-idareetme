import type { PartsRights } from "@/lib/permission-model";

// Versiya 3.19: the parts of the Personallar card (SECTION_PARTS["hr.personnel"] in lib/permission-model.ts) and what each
// part holds — shared by the server (which sends a part's data only when it may be seen, and keeps a part's stored values
// when it may not be changed) and the page (which shows only the parts that may be seen).
// Always seen with the card: name, firm, department, position, hire date, status (termination date) and the work week.

// hr_employees columns of each part; monthly_salary belongs to Əmək haqqı, marital_status to Ailə üzvləri.
export const PART_COLUMNS: Record<string, string[]> = {
  personal: ["birth_date", "gender", "phone", "photo_key", "photo_name", "note"],
  emergency: ["emergency_name", "emergency_relation", "emergency_phone"],
  idcard: ["fin", "id_series", "id_number", "id_issued_by", "id_issued_at", "id_valid_until", "reg_address", "id_front_key", "id_front_name", "id_back_key", "id_back_name"],
  workplace: ["user_employee_id", "user_employee_name"],
  contract: ["contract_no", "contract_date", "contract_type", "contract_end_date", "probation_months", "hire_order_no", "hire_order_date"],
  entitlement: ["prior_experience_months", "prior_experience_days", "base_leave_days", "extra_leave_days", "extra_leave_note", "opening_balance_date", "opening_balance_days"],
  termination: ["termination_reason", "termination_order_id"],
  family: ["marital_status"],
  salary: ["monthly_salary"],
};

// The card form's fields of each part (what /api/hr receives on saving a card); the name is changed with Şəxsi məlumatlar.
export const PART_INPUTS: Record<string, string[]> = {
  personal: ["lastName", "firstName", "patronymic", "birthDate", "gender", "phone", "photoKey", "photoName", "note"],
  emergency: ["emergencyName", "emergencyRelation", "emergencyPhone"],
  idcard: ["fin", "idSeries", "idNumber", "idIssuedBy", "idIssuedAt", "idValidUntil", "regAddress", "idFrontKey", "idFrontName", "idBackKey", "idBackName"],
  workplace: ["companyId", "department", "position", "hireDate", "workWeek", "jobKind", "userEmployeeId"],
  contract: ["contractNo", "contractDate", "contractType", "contractEndDate", "probationMonths", "hireOrderNo", "hireOrderDate"],
  entitlement: ["priorExperienceMonths", "priorExperienceDays", "baseLeaveDays", "extraLeaveDays", "extraLeaveNote", "openingBalanceDate", "openingBalanceDays"],
  salary: ["monthlySalary"],
};

// The leave balance is worked out from the entitlement and the recorded leaves, so it is shown only with both; the final
// settlement shows salaries, the balance and the average pay, so it needs Əmək haqqı and the leave parts as well.
export const canSeeBalance = (parts: PartsRights) => parts.entitlement.view && parts.leaves.view;
export const canSeeSettlement = (parts: PartsRights) => parts.settlement.view && parts.salary.view && canSeeBalance(parts);

type Row = Record<string, unknown>;

// One HR card with the columns of the parts that may not be seen emptied.
export function stripHrEmployee<T extends Row>(employee: T, parts: PartsRights): T {
  const copy: Row = { ...employee };
  for (const [part, columns] of Object.entries(PART_COLUMNS)) if (!parts[part]?.view) for (const column of columns) copy[column] = null;
  return copy as T;
}

// The whole /api/hr data narrowed to what may be seen: partsOf gives the rights in a card's firm.
export function stripHrData<T extends Row>(data: T, partsOf: (companyId: number) => PartsRights): T {
  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as Row[]) : []);
  const employees = list("employees");
  const rights = new Map(employees.map((e) => [Number(e.id), partsOf(Number(e.company_id))]));
  const may = (row: Row, part: string) => Boolean(rights.get(Number(row.hr_employee_id))?.[part]?.view);
  return {
    ...data,
    employees: employees.map((e) => stripHrEmployee(e, rights.get(Number(e.id))!)),
    leaves: list("leaves").filter((l) => may(l, l.kind === "sick" ? "sick" : "leaves")),
    salaries: list("salaries").filter((s) => may(s, "salary")),
    priorJobs: list("priorJobs").filter((j) => may(j, "priorJobs")),
    family: list("family").filter((f) => may(f, "family")),
    education: list("education").filter((x) => may(x, "education")),
  };
}
