export interface AuditLog {
  id: number;
  actor_id: string | null;
  subject_user_id: string | null;
  module_key: string;
  action: string;
  source_table: string;
  record_id: string | null;
  record_label: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  event_at: string;
}
