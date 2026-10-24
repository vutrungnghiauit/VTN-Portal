import { supabase } from "../../lib/supabase";
import type { SystemTrashEntry } from "./trash.types";

function client() {
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  return supabase;
}

export const systemTrashService = {
  async list(): Promise<SystemTrashEntry[]> {
    const { data, error } = await client().rpc("list_system_trash");
    if (error) throw error;
    return (data ?? []) as SystemTrashEntry[];
  },
  async listByEntityType(entityType: string): Promise<SystemTrashEntry[]> {
    const { data, error } = await client().rpc("list_system_trash_by_type", { p_entity_type: entityType });
    if (error) throw error;
    return (data ?? []) as SystemTrashEntry[];
  },
  async setState(entityType: string, entityId: string, restore: boolean) {
    if (entityType === "user_profiles") {
      const { data, error } = await client().functions.invoke("swift-api", { body: { action: restore ? "restore-account" : "delete", userId: entityId } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return;
    }
    const { error } = await client().rpc("set_system_trash_state", {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_restore: restore,
    });
    if (error) throw error;
  },
  async deletePermanently(entityType: string, entityId: string, expiredOnly = false) {
    if (entityType === "user_profiles") {
      const { data, error } = await client().functions.invoke("swift-api", { body: { action: "purge-account", userId: entityId, expiredOnly } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return;
    }
    if (entityType === "academic_ai_sources") {
      const { data, error } = await client().functions.invoke("academic-ai", { body: { action: "purge-source", sourceId: entityId, expiredOnly } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return;
    }
    const { error } = await client().rpc("delete_system_trash_item", {
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
    if (error) throw error;
  },
  async deleteSurveyPermanently(surveyId: string, expiredOnly = false) {
    const { data, error } = await client().functions.invoke("swift-api", { body: { action: "purge-survey", userId: surveyId, expiredOnly } });
    if (error) throw error;
    if (data?.error) throw new Error(String(data.error));
  },
};
