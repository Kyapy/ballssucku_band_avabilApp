import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
import { supabase, supabaseConfigError } from './lib/supabaseClient'
import {
  fetchAvailabilityForMonth,
  fetchMembers,
  toggleAvailability,
  upsertMember,
  type AvailabilityRow,
  type Member,
  type TimeBlock,
} from './lib/data'
import type { Session, User } from '@supabase/supabase-js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BLOCKS: Array<{ key: TimeBlock; label: string }> = [
  { key: 'day', label: 'Day (9-15)' },
  { key: 'evening', label: 'Evening (16-21)' },
]

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
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

function monthBounds(month: Date): { start: string; end: string } {
  const startDate = new Date(month.getFullYear(), month.getMonth(), 1)
  const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  return {
    start: formatDateKey(startDate),
    end: formatDateKey(endDate),
  }
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
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [nameInput, setNameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [dataLoading, setDataLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [availability, setAvailability] = useState<AvailabilityRow[]>([])
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  )

  const user = session?.user ?? null
  const membersCount = members.length
  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  const dayList = useMemo(() => buildMonthGrid(visibleMonth), [visibleMonth])

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

  const refreshMonthData = useCallback(
    async (month: Date, currentUser: User | null) => {
      if (!supabase || !currentUser) {
        setMembers([])
        setAvailability([])
        return
      }

      setDataLoading(true)
      setErrorMessage(null)
      try {
        const { start, end } = monthBounds(month)
        const [fetchedMembers, fetchedAvailability] = await Promise.all([
          fetchMembers(),
          fetchAvailabilityForMonth(start, end),
        ])
        setMembers(fetchedMembers)
        setAvailability(fetchedAvailability)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load data.'
        setErrorMessage(message)
      } finally {
        setDataLoading(false)
      }
    },
    [],
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
    refreshMonthData(visibleMonth, user)
  }, [refreshMonthData, user, visibleMonth])

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

    if (authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: passwordInput,
        options: {
          data: {
            display_name: trimmedName,
          },
        },
      })

      if (error) {
        setErrorMessage(error.message)
      } else if (!data.session) {
        setErrorMessage(
          'Account created. If email confirmation is enabled, disable it for name/password login.',
        )
      }
      setAuthBusy(false)
      return
    }

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
      await refreshMonthData(visibleMonth, user)
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
                {authMode === 'signup' ? 'Create account' : 'Log in'}
              </button>
              <button
                type="button"
                disabled={authBusy || authLoading}
                onClick={() =>
                  setAuthMode((prev) => (prev === 'login' ? 'signup' : 'login'))
                }
              >
                {authMode === 'login' ? 'Need account?' : 'Have account?'}
              </button>
            </form>
          )}
        </div>
      </header>

      {authLoading ? <p>Checking session...</p> : null}
      {dataLoading ? <p>Loading availability...</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

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

      <section className="calendar-grid">
        {WEEKDAYS.map((day) => (
          <div className="weekday" key={day}>
            {day}
          </div>
        ))}

        {dayList.map((date) => {
          const dateKey = formatDateKey(date)
          const inMonth = date.getMonth() === visibleMonth.getMonth()

          return (
            <div
              className={`day-cell${inMonth ? '' : ' outside-month'}`}
              key={dateKey}
            >
              <div className="day-label">{date.getDate()}</div>

              {BLOCKS.map((block) => {
                const key = `${dateKey}|${block.key}`
                const count = availabilityByBlock.get(key)?.size ?? 0
                const everyone =
                  membersCount > 0 && count === membersCount && inMonth
                const mine = myAvailability.has(key)

                return (
                  <div
                    className={`block-row${everyone ? ' everyone' : ''}`}
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
                      {block.label}
                    </button>
                    <span className="count">{count + '/' + membersCount}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </section>
    </div>
  )
}

export default App
