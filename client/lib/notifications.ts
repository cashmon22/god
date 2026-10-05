import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification } from "@shared/notifications";
import { apiRequest } from "./api-request";
import { supabase } from "./supabase";
import { listConversations } from "./vendor-messages";

export function listNotifications() {
  return apiRequest<AppNotification[]>("/api/notifications");
}

export function markNotificationRead(id: string) {
  return apiRequest<{ success: boolean }>(`/api/notifications/${id}/read`, {
    method: "PATCH",
  });
}

export function markAllNotificationsRead() {
  return apiRequest<{ success: boolean }>("/api/notifications/read-all", {
    method: "PATCH",
  });
}

/**
 * Hook: notifications list + unread count + realtime updates.
 * Used by the NotificationCenter bell component.
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const channelRef = useRef(
    `notifications-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const load = useCallback(async () => {
    try {
      setNotifications(await listNotifications());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const channel = supabase
      .channel(channelRef.current)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications" },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, []);

  return { notifications, unreadCount, isLoading, error, retry: load, markRead, markAllRead };
}

/**
 * Hook: unread message count for the Messages badge.
 * role "user" sums userUnreadCount, role "admin" sums adminUnreadCount.
 * Subscribes to realtime updates on vendor_conversations and vendor_messages.
 */
export function useUnreadMessageCount(role: "user" | "admin") {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const channelRef = useRef(
    `unread-msg-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const conversations = await listConversations();
        if (!isMounted) return;
        const unread = conversations.reduce(
          (sum, c) =>
            sum + (role === "admin" ? c.adminUnreadCount : c.userUnreadCount),
          0,
        );
        setCount(unread);
      } catch {
        // ignore
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void load();

    const channel = supabase
      .channel(channelRef.current)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vendor_messages" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "vendor_conversations" },
        () => void load(),
      )
      .subscribe();

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [role]);

  return { count, isLoading };
}
