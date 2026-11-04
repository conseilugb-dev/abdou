export type Role = "admin" | "responsable" | "member";
export type MemberStatus = "active" | "inactive";
export type ActivityStatus = "prévue" | "en cours" | "terminée" | "annulée";
export type AttendanceStatus = "Présent" | "Absent";

export interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  organization_id: string;
  section_id: string | null;
  member_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  birth_date: string | null;
  locality: string | null;
  function_name: string | null;
  photo_url: string | null;
  status: MemberStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  organization_id: string;
  activity_type_id: string | null;
  name: string;
  description: string | null;
  location: string | null;
  start_datetime: string;
  end_datetime: string | null;
  responsible_id: string | null;
  status: ActivityStatus;
  qr_token: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  id: string;
  activity_id: string;
  member_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  recorded_by: string | null;
  method: "qr" | "manual";
  notes: string | null;
  created_at: string;
  updated_at: string;
}