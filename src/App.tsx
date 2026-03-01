import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import './App.css'
import { supabase, supabaseConfigError } from './lib/supabaseClient'
import {
  fetchAvailabilityFromDate,
  fetchAvailabilityForMonth,
  fetchMembersCount,
  fetchMembers,
  toggleAvailability,
  upsertMember,
  type AvailabilityRow,
  type Member,
  type TimeBlock,
} from './lib/data'
import type { Session } from '@supabase/supabase-js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BLOCKS: Array<{ key: TimeBlock; label: string; timeRange: string }> = [
  { key: 'day', label: 'Morning', timeRange: '9am to 3pm' },
  { key: 'evening', label: 'Evening', timeRange: '4pm to 9pm' },
]
const BLOCK_ORDER: Record<TimeBlock, number> = { day: 0, evening: 1 }
const BLOCK_SHORT_LABEL: Record<TimeBlock, string> = {
  day: 'Morning',
  evening: 'Evening',
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    return formatDateKey(date)
  }

  return `${year}-${month}-${day}`
}

function getMonthStartInTimeZone(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())

  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }

  return new Date(year, month - 1, 1)
}

function buildMonthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function gridBounds(month: Date): { start: string; end: string } {
  const gridDays = buildMonthGrid(month)
  const startDate = gridDays[0]
  const endDate = gridDays[gridDays.length - 1]
  return {
    start: formatDateKey(startDate),
    end: formatDateKey(endDate),
  }
}

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function nameToEmail(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')

  return normalized ? `${normalized}@band.local` : ''
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [dataLoading, setDataLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [membersDbCount, setMembersDbCount] = useState(0)
  const [availability, setAvailability] = useState<AvailabilityRow[]>([])
  const [upcomingAvailability, setUpcomingAvailability] = useState<
    AvailabilityRow[]
  >([])
  const latestMonthRequestRef = useRef(0)
  const [visibleMonth, setVisibleMonth] = useState(() =>
    getMonthStartInTimeZone('Australia/Brisbane'),
  )

  const user = session?.user ?? null
  const statusMessage =
    errorMessage ??
    (authLoading
      ? 'Checking session...'
      : dataLoading
        ? 'Loading availability...'
        : '')
  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  const dayList = useMemo(() => buildMonthGrid(visibleMonth), [visibleMonth])
  const todayKey = formatDateKeyInTimeZone(new Date(), 'Australia/Brisbane')

  const availabilityByBlock = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const row of availability) {
      const key = `${row.date}|${row.time_block}`
      if (!map.has(key)) {
        map.set(key, new Set<string>())
      }
      map.get(key)!.add(row.user_id)
    }
    return map
  }, [availability])

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of members) {
      map.set(member.user_id, member.display_name)
    }
    return map
  }, [members])

  const availabilityNamesByBlock = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const [key, users] of availabilityByBlock.entries()) {
      const names = Array.from(users)
        .map((userId) => memberNameById.get(userId) ?? 'Member')
        .sort((a, b) => a.localeCompare(b))
      map.set(key, names)
    }
    return map
  }, [availabilityByBlock, memberNameById])

  const upcomingAvailabilityByBlock = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const row of upcomingAvailability) {
      const key = `${row.date}|${row.time_block}`
      if (!map.has(key)) {
        map.set(key, new Set<string>())
      }
      map.get(key)!.add(row.user_id)
    }
    return map
  }, [upcomingAvailability])

  const myAvailability = useMemo(() => {
    const set = new Set<string>()
    if (!user) {
      return set
    }

    for (const row of availability) {
      if (row.user_id === user.id) {
        set.add(`${row.date}|${row.time_block}`)
      }
    }
    return set
  }, [availability, user])

  const availabilityUserIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of availability) {
      ids.add(row.user_id)
    }
    for (const row of upcomingAvailability) {
      ids.add(row.user_id)
    }
    return ids
  }, [availability, upcomingAvailability])

  const membersCount =
    membersDbCount > 0
      ? membersDbCount
      : Math.max(members.length, availabilityUserIds.size)

  const everyoneAvailabilityList = useMemo(() => {
    if (membersCount === 0) {
      return []
    }

    return Array.from(upcomingAvailabilityByBlock.entries())
      .filter(([, users]) => users.size === membersCount)
      .map(([key]) => {
        const [dateKey, timeBlock] = key.split('|') as [string, TimeBlock]
        const date = dateFromKey(dateKey)
        return {
          key,
          dateKey,
          timeBlock,
          monthKey: dateKey.slice(0, 7),
          monthLabel: date.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          }),
          displayDate: date.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }),
          isWeekend: date.getDay() === 0 || date.getDay() === 6,
        }
      })
      .sort((a, b) => {
        if (a.dateKey !== b.dateKey) {
          return a.dateKey.localeCompare(b.dateKey)
        }
        return BLOCK_ORDER[a.timeBlock] - BLOCK_ORDER[b.timeBlock]
      })
  }, [membersCount, upcomingAvailabilityByBlock])

  const everyoneAvailabilityByMonth = useMemo(() => {
    const grouped = new Map<
      string,
      { monthLabel: string; items: typeof everyoneAvailabilityList }
    >()

    for (const item of everyoneAvailabilityList) {
      if (!grouped.has(item.monthKey)) {
        grouped.set(item.monthKey, { monthLabel: item.monthLabel, items: [] })
      }
      grouped.get(item.monthKey)!.items.push(item)
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, value]) => ({
        monthKey,
        monthLabel: value.monthLabel,
        items: value.items,
      }))
  }, [everyoneAvailabilityList])

  const refreshMonthData = useCallback(
    async (
      month: Date,
      options?: { showLoading?: boolean },
    ) => {
      const showLoading = options?.showLoading ?? true
      const requestId = latestMonthRequestRef.current + 1
      latestMonthRequestRef.current = requestId

      if (!supabase) {
        setMembers([])
        setMembersDbCount(0)
        setAvailability([])
        setUpcomingAvailability([])
        return
      }

      if (showLoading) {
        setDataLoading(true)
      }
      setErrorMessage(null)
      try {
        const { start, end } = gridBounds(month)
        const [
          fetchedMembers,
          fetchedMembersCount,
          fetchedAvailability,
          fetchedUpcoming,
        ] =
          await Promise.all([
            fetchMembers(),
            fetchMembersCount(),
            fetchAvailabilityForMonth(start, end),
            fetchAvailabilityFromDate(todayKey),
          ])
        if (latestMonthRequestRef.current !== requestId) {
          return
        }
        setMembers(fetchedMembers)
        setMembersDbCount(fetchedMembersCount)
        setAvailability(fetchedAvailability)
        setUpcomingAvailability(fetchedUpcoming)
      } catch (error) {
        if (latestMonthRequestRef.current !== requestId) {
          return
        }
        const message =
          error instanceof Error ? error.message : 'Failed to load data.'
        setErrorMessage(message)
      } finally {
        if (showLoading && latestMonthRequestRef.current === requestId) {
          setDataLoading(false)
        }
      }
    },
    [todayKey],
  )

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }
    const client = supabase

    const initialize = async () => {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await client.auth.getSession()
        if (error) {
          throw error
        }
        setSession(currentSession)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to initialize auth.'
        setErrorMessage(message)
      } finally {
        setAuthLoading(false)
      }
    }

    initialize()

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !user) {
      return
    }

    const syncMember = async () => {
      try {
        await upsertMember(user)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to sync member.'
        setErrorMessage(message)
      }
    }

    syncMember()
  }, [user])

  useEffect(() => {
    refreshMonthData(visibleMonth)
  }, [refreshMonthData, visibleMonth])

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!supabase) {
      return
    }

    const trimmedName = nameInput.trim()
    if (!trimmedName) {
      setErrorMessage('Please enter your name.')
      return
    }

    if (!passwordInput) {
      setErrorMessage('Please enter your password.')
      return
    }

    const email = nameToEmail(trimmedName)
    if (!email) {
      setErrorMessage('Name must contain at least one letter or number.')
      return
    }

    setErrorMessage(null)
    setAuthBusy(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: passwordInput,
    })

    if (error) {
      setErrorMessage(error.message)
    }
    setAuthBusy(false)
  }

  const handleLogout = async () => {
    if (!supabase) {
      return
    }

    const { error } = await supabase.auth.signOut()
    if (error) {
      setErrorMessage(error.message)
    }
  }

  const handleToggle = async (dateKey: string, block: TimeBlock) => {
    if (!user) {
      return
    }

    const key = `${dateKey}|${block}`
    const isAvailable = myAvailability.has(key)

    setErrorMessage(null)
    try {
      await toggleAvailability(user.id, dateKey, block, isAvailable)
      await refreshMonthData(visibleMonth, { showLoading: false })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update row.'
      setErrorMessage(message)
    }
  }

  if (supabaseConfigError) {
    return (
      <div className="app-shell">
        <h1>Band Availability</h1>
        <p className="error-text">{supabaseConfigError}</p>
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`.</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Band Availability</h1>
        <div className="auth-actions">
          {user ? (
            <>
              <span className="user-pill">
                {user.user_metadata?.display_name ??
                  user.user_metadata?.full_name ??
                  user.email ??
                  'Member'}
              </span>
              <button onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <form className="auth-form" onSubmit={handleAuthSubmit}>
              <input
                type="text"
                placeholder="Name"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                disabled={authBusy || authLoading}
              />
              <input
                type="password"
                placeholder="Password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                disabled={authBusy || authLoading}
              />
              <button type="submit" disabled={authBusy || authLoading}>
                Log in
              </button>
            </form>
          )}
        </div>
      </header>

      <p className={`status-line${errorMessage ? ' error-text' : ''}`}>
        {statusMessage}
      </p>

      <section className="calendar-layout month-nav-layout">
        <section className="month-controls">
          <button
            onClick={() =>
              setVisibleMonth(
                (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
              )
            }
          >
            Prev
          </button>
          <h2>{monthLabel}</h2>
          <button
            onClick={() =>
              setVisibleMonth(
                (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
              )
            }
          >
            Next
          </button>
        </section>
        <div className="month-nav-spacer" aria-hidden="true" />
      </section>

      <section className="calendar-layout">
        <div className="calendar-scroll">
          <section className="calendar-grid">
            {WEEKDAYS.map((day, index) => (
              <div
                className={`weekday${index === 0 || index === 6 ? ' weekend' : ''}`}
                key={day}
              >
                {day}
              </div>
            ))}

            {dayList.map((date) => {
              const dateKey = formatDateKey(date)
              const inMonth = date.getMonth() === visibleMonth.getMonth()
              const isWeekend = date.getDay() === 0 || date.getDay() === 6
              const isTodayAest = dateKey === todayKey
              const hasEveryoneInDay =
                inMonth &&
                membersCount > 0 &&
                BLOCKS.some((block) => {
                  const key = `${dateKey}|${block.key}`
                  const count = availabilityByBlock.get(key)?.size ?? 0
                  return count === membersCount
                })

              return (
                <div
                  className={`day-cell ${isWeekend ? 'weekend' : 'weekday'}${
                    inMonth ? '' : ' outside-month'
                  }${hasEveryoneInDay ? ' everyone-day' : ''}${
                    isTodayAest ? ' today-card' : ''
                  }`}
                  key={dateKey}
                >
                  <div className={`day-label${isWeekend ? ' weekend-date' : ''}`}>
                    {date.getDate()}
                  </div>

                  {BLOCKS.map((block) => {
                    const key = `${dateKey}|${block.key}`
                    const count = availabilityByBlock.get(key)?.size ?? 0
                    const availableNames = availabilityNamesByBlock.get(key) ?? []
                    const everyone =
                      membersCount > 0 && count === membersCount && inMonth
                    const mine = myAvailability.has(key)

                    return (
                      <div
                        className={`block-row${everyone ? ' everyone' : ''}${
                          availableNames.length > 0 ? ' has-availability' : ''
                        }`}
                        key={block.key}
                      >
                        <button
                          className={`toggle-btn${mine ? ' active' : ''}`}
                          onClick={() => handleToggle(dateKey, block.key)}
                          disabled={!user || !inMonth}
                          title={
                            user
                              ? `Toggle ${block.label.toLowerCase()} availability`
                              : 'Sign in to edit availability'
                          }
                        >
                          <span className="toggle-label">{block.label}</span>
                          <span className="toggle-time">{block.timeRange}</span>
                        </button>
                        <span className="count">{count + '/' + membersCount}</span>
                        {availableNames.length > 0 ? (
                          <div className="availability-popover" role="tooltip">
                            <p className="popover-title">
                              Available ({availableNames.length})
                            </p>
                            <ul className="popover-list">
                              {availableNames.map((name) => (
                                <li key={name}>{name}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </section>
        </div>

        <aside className="everyone-sidebar">
          <h3>Everyone Available</h3>
          {everyoneAvailabilityList.length === 0 ? (
            <p className="sidebar-empty">
              No upcoming full-band slots.
            </p>
          ) : (
            <div className="everyone-groups">
              {everyoneAvailabilityByMonth.map((group) => (
                <section className="everyone-month-group" key={group.monthKey}>
                  <h4>{group.monthLabel}</h4>
                  <ul className="everyone-list">
                    {group.items.map((item) => (
                      <li key={item.key}>
                        <span
                          className={item.isWeekend ? 'weekend-item-date' : ''}
                        >
                          {item.displayDate}
                        </span>
                        <strong
                          className={`slot-label ${
                            item.timeBlock === 'day'
                              ? 'morning-label'
                              : 'evening-label'
                          }`}
                        >
                          {BLOCK_SHORT_LABEL[item.timeBlock]}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </aside>
      </section>
    </div>
  )
}

export default App
