// Real Supabase-backed API client (Phase 1).
// All functions return the same shapes the rest of the app expects, so the
// frontend doesn't need to change. This file is the only place the database
// is touched.

import { supabase } from './lib/supabase';

export interface User {
  id: string;
  username: string;          // may be empty string before the user has claimed one
  email?: string | null;
  avatarUrl?: string | null;
}

export interface BoxContent {
  kind: 'youtube';
  data: { videoId: string };
}

export interface BoxActivity {
  liveViews: number;
  hourlyViews: number;
  dailyViews: number;
  likesCount: number;
  rankScore: number;
  lastActiveAt: number;
}

export interface BoxRecord {
  x: number;
  y: number;
  ownerId?: string | null;
  ownerUsername?: string | null;
  content?: BoxContent | null;
  activity?: BoxActivity;
  free?: boolean;
  updatedAt?: number;
}

// ───────────────────── helpers ─────────────────────
function rowToBox(row: any): BoxRecord {
  const content: BoxContent | null =
    row.content_kind === 'youtube' && row.content_data?.videoId
      ? { kind: 'youtube', data: { videoId: row.content_data.videoId } }
      : null;
  return {
    x: row.x,
    y: row.y,
    ownerId: row.owner_id ?? null,
    ownerUsername: row.owner_username ?? null,
    content,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : undefined,
    activity: {
      liveViews: row.live_views ?? 0,
      hourlyViews: row.hourly_views ?? 0,
      dailyViews: row.daily_views ?? 0,
      likesCount: row.likes_count ?? 0,
      rankScore: row.rank_score ?? 0,
      lastActiveAt: row.last_active_at
        ? Date.parse(row.last_active_at)
        : Date.now(),
    },
  };
}

function parseYoutubeId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/
  );
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  return null;
}

// ───────────────────── api ─────────────────────
export const api = {
  // Sign in via Google. Browser navigates to Google's consent page and back
  // to /auth/callback, where supabase.auth.getSession() resolves the session.
  async signInWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback' },
    });
    if (error) throw new Error(error.message);
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  },

  // Read the current user's profile row from public.users.
  async getMyProfile(): Promise<User | null> {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return null;
    const { data, error } = await supabase
      .from('users')
      .select('id, username, email, avatar_url')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        id: session.user.id,
        username: '',
        email: session.user.email ?? null,
        avatarUrl: null,
      };
    }
    return {
      id: data.id,
      username: data.username ?? '',
      email: data.email ?? session.user.email ?? null,
      avatarUrl: data.avatar_url ?? null,
    };
  },

  async setUsername(username: string): Promise<User> {
    const { error } = await supabase.rpc('set_username', { p_username: username });
    if (error) throw new Error(error.message.includes('username') ? error.message : 'Username taken or invalid');
    const me = await api.getMyProfile();
    if (!me) throw new Error('not signed in');
    return me;
  },

  // Read a single box (used for direct /x/y URL navigation).
  async getBox(x: number, y: number): Promise<BoxRecord> {
    const { data, error } = await supabase
      .from('box_feed')
      .select('*')
      .eq('x', x)
      .eq('y', y)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { x, y, free: true };
    return rowToBox(data);
  },

  // Ranked feed of all owned boxes.
  async getFeed(): Promise<{ items: BoxRecord[]; version: number }> {
    const { data, error } = await supabase
      .from('box_feed')
      .select('*')
      .order('rank_score', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const items = (data ?? []).map(rowToBox);
    return { items, version: Date.now() };
  },

  // Resolve a (x, y) → its current rank in the feed (linear scan; the feed
  // is small in Phase 1). Phase 8b will replace with a Redis-cached lookup.
  async getBoxRank(x: number, y: number): Promise<{ rank: number | null }> {
    const { items } = await api.getFeed();
    const idx = items.findIndex((b) => b.x === x && b.y === y);
    return { rank: idx >= 0 ? idx : null };
  },

  // Atomically claim the next free spiral coordinate.
  async claimNextBox(): Promise<BoxRecord> {
    const { data, error } = await supabase.rpc('claim_next_box');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('claim failed');
    return await api.getBox(row.x, row.y);
  },

  async setContent(
    x: number,
    y: number,
    _token: string | null,
    kind: 'youtube',
    data: Record<string, unknown>
  ): Promise<BoxRecord> {
    const id = parseYoutubeId(String((data as any)?.url ?? ''));
    if (!id) throw new Error('invalid YouTube URL');
    const { error } = await supabase.rpc('set_box_content', {
      p_x: x,
      p_y: y,
      p_kind: kind,
      p_data: { videoId: id },
    });
    if (error) throw new Error(error.message);
    return await api.getBox(x, y);
  },

  async listMyBoxes(): Promise<BoxRecord[]> {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return [];
    const { data, error } = await supabase
      .from('box_feed')
      .select('*')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToBox);
  },

  async heartbeat(x: number, y: number, _token: string | null): Promise<void> {
    const { error } = await supabase.rpc('box_heartbeat', { p_x: x, p_y: y });
    if (error) {
      // never break scrolling because of a heartbeat error
      // eslint-disable-next-line no-console
      console.warn('heartbeat failed', error.message);
    }
  },
};
