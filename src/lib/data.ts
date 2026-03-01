import type { User } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

export type TimeBlock = 'day' | 'evening'

export type AvailabilityRow = {
  id: string
  user_id: string
  date: string
  time_block: TimeBlock
}

export type Member = {
  user_id: string
  display_name: string
}

function ensureSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  return supabase
}

export async function upsertMember(user: User): Promise<void> {
  const client = ensureSupabase()
  const displayName =
    (user.user_metadata?.display_name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split('@')[0] ??
    'Member'

  const { error } = await client.from('members').upsert(
    {
      user_id: user.id,
      display_name: displayName,
    },
    { onConflict: 'user_id' },
  )

  if (error) {
    throw error
  }
}

export async function fetchMembers(): Promise<Member[]> {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('members')
    .select('user_id, display_name')
    .order('display_name', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as Member[]
}

export async function fetchMembersCount(): Promise<number> {
  const client = ensureSupabase()
  const { count, error } = await client
    .from('members')
    .select('user_id', { count: 'exact', head: true })

  if (error) {
    throw error
  }

  return count ?? 0
}

export async function fetchAvailabilityForMonth(
  startDate: string,
  endDate: string,
): Promise<AvailabilityRow[]> {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('availability')
    .select('id, user_id, date, time_block')
    .gte('date', startDate)
    .lte('date', endDate)

  if (error) {
    throw error
  }

  return (data ?? []) as AvailabilityRow[]
}

export async function fetchAvailabilityFromDate(
  startDate: string,
): Promise<AvailabilityRow[]> {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('availability')
    .select('id, user_id, date, time_block')
    .gte('date', startDate)

  if (error) {
    throw error
  }

  return (data ?? []) as AvailabilityRow[]
}

export async function toggleAvailability(
  userId: string,
  date: string,
  timeBlock: TimeBlock,
  currentlyAvailable: boolean,
): Promise<void> {
  const client = ensureSupabase()

  if (currentlyAvailable) {
    const { error } = await client
      .from('availability')
      .delete()
      .eq('user_id', userId)
      .eq('date', date)
      .eq('time_block', timeBlock)

    if (error) {
      throw error
    }
    return
  }

  const { error } = await client.from('availability').insert({
    user_id: userId,
    date,
    time_block: timeBlock,
  })

  if (error) {
    throw error
  }
}
