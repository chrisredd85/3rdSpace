# Session Management & Authentication Middleware

This document outlines the complete authentication middleware and session management system.

## ✅ Implementation Summary

### 1. Authentication Middleware (`/middleware.ts`)

**Features:**
- ✅ Checks authentication for dashboard routes (`/builder`, `/venue`, `/vendor`)
- ✅ Redirects to `/login` if not authenticated
- ✅ Allows public access to `/login`, `/signup`, `/`, and API routes
- ✅ Redirects authenticated users away from login/signup pages
- ✅ Verifies user has access to correct dashboard based on `user_type`
- ✅ Automatically redirects to correct dashboard if user accesses wrong one
- ✅ Uses Supabase server client to verify session
- ✅ Automatically refreshes session if needed

**Route Protection:**
- **Public Routes**: `/login`, `/signup`, `/`, `/api/*`
- **Protected Routes**: `/builder/*`, `/venue/*`, `/vendor/*`
- **Auto-redirect**: If authenticated user visits `/login` or `/signup`, redirects to their dashboard

### 2. User API Endpoint (`/app/api/auth/user/route.ts`)

**Method**: GET

**Purpose**: Fetch current authenticated user information

**Response:**
```json
{
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "name": "User Name",
    "userType": "community_builder" | "venue_owner" | "vendor" | null
  }
}
```

**Error Response (401):**
```json
{
  "error": "Not authenticated"
}
```

### 3. User Hook (`/lib/hooks/useUser.ts`)

**Features:**
- ✅ Fetches user from `/api/auth/user` endpoint
- ✅ Uses React Query for caching (5 minutes)
- ✅ Automatic refetch on window focus
- ✅ Handles loading and error states
- ✅ Returns `isAuthenticated` boolean

**Usage:**
```typescript
const { user, isLoading, isAuthenticated, error, refetch } = useUser()
```

**Returns:**
- `user`: User object with id, email, name, userType (or null)
- `isLoading`: Boolean indicating loading state
- `isAuthenticated`: Boolean indicating if user is authenticated
- `isError`: Boolean indicating if there was an error
- `error`: Error message string
- `refetch`: Function to manually refetch user data

### 4. Session Refresh Hook (`/lib/hooks/useSessionRefresh.ts`)

**Features:**
- ✅ Automatically refreshes session every 5 minutes
- ✅ Refreshes on window focus (user returns to tab)
- ✅ Detects session expiration
- ✅ Redirects to login with error message if session expires
- ✅ Cleans up intervals on unmount

**Usage:**
```typescript
useSessionRefresh() // Call in dashboard layout or protected components
```

### 5. Session Refresh API (`/app/api/auth/refresh/route.ts`)

**Method**: POST

**Purpose**: Manually refresh an expiring session

**Response:**
```json
{
  "success": true,
  "session": {
    "access_token": "...",
    "expires_at": 1234567890
  }
}
```

### 6. Dashboard Layout Updates (`/app/(dashboard)/layout.tsx`)

**Features:**
- ✅ Uses `useUser` hook instead of direct Supabase calls
- ✅ Uses `useSessionRefresh` for automatic session management
- ✅ Redirects to login if not authenticated
- ✅ Redirects to correct dashboard based on `user_type`
- ✅ Shows loading spinner while checking authentication
- ✅ Prevents rendering if not authenticated

**Dashboard Routing:**
- `community_builder` → `/builder`
- `venue_owner` → `/venue`
- `vendor` → `/vendor`

## 🔄 Session Refresh Flow

1. **Automatic Refresh (Middleware)**
   - Middleware automatically refreshes session on each request
   - Uses `supabase.auth.getUser()` which handles refresh internally

2. **Periodic Refresh (Client)**
   - `useSessionRefresh` hook checks session every 5 minutes
   - Refetches user data to verify session validity
   - Redirects to login if session expired

3. **Window Focus Refresh**
   - When user returns to tab, session is automatically checked
   - Ensures session is still valid after inactivity

4. **Manual Refresh**
   - Can call `/api/auth/refresh` endpoint if needed
   - Useful for long-running operations

## 🛡️ Security Features

1. **Server-Side Verification**: All authentication checks happen server-side
2. **Automatic Session Refresh**: Sessions refresh before expiration
3. **Route Protection**: Middleware protects all dashboard routes
4. **User Type Verification**: Users can only access their own dashboard
5. **Session Expiration Handling**: Graceful redirect to login with error message

## 📋 Error Handling

### Session Expiration
- **Detection**: Automatic via `useSessionRefresh` hook
- **Action**: Redirect to `/login?error=session_expired&message=Your session has expired. Please sign in again.`
- **User Experience**: Toast notification with clear message

### Invalid Session
- **Detection**: API returns 401 on `/api/auth/user`
- **Action**: Redirect to login
- **User Experience**: Loading state, then redirect

### Wrong Dashboard Access
- **Detection**: Middleware checks `user_type` vs route
- **Action**: Redirect to correct dashboard
- **User Experience**: Seamless redirect, no error shown

## 🧪 Testing

### Test Middleware Protection
```bash
# Try accessing protected route without auth
curl http://localhost:3000/builder

# Should redirect to /login
```

### Test User API
```bash
# Get current user (requires authentication)
curl http://localhost:3000/api/auth/user \
  -H "Cookie: sb-<project>-auth-token=..."
```

### Test Session Refresh
```bash
# Refresh session
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Cookie: sb-<project>-auth-token=..."
```

## 🔍 Debugging

### Check Session Status
1. Open browser DevTools → Application → Cookies
2. Look for `sb-<project>-auth-token` cookie
3. Check if it exists and has a valid value

### Check User Data
1. Use `useUser` hook in a component
2. Check React Query DevTools for cached data
3. Verify `isAuthenticated` state

### Check Middleware
1. Add console.logs in middleware.ts
2. Check server logs for middleware execution
3. Verify redirects are happening correctly

## 📝 Usage Examples

### In a Protected Component
```typescript
'use client'

import { useUser } from '@/lib/hooks/useUser'

export default function ProtectedComponent() {
  const { user, isLoading, isAuthenticated } = useUser()

  if (isLoading) return <div>Loading...</div>
  if (!isAuthenticated) return <div>Not authenticated</div>

  return <div>Welcome, {user?.name}!</div>
}
```

### In Dashboard Layout
```typescript
'use client'

import { useUser } from '@/lib/hooks/useUser'
import { useSessionRefresh } from '@/lib/hooks/useSessionRefresh'

export default function DashboardLayout({ children }) {
  const { user, isLoading, isAuthenticated } = useUser()
  useSessionRefresh() // Auto-refresh session

  // ... rest of component
}
```

## 🚀 Next Steps

1. **Add Session Timeout Warning**: Show warning 1 minute before expiration
2. **Add "Remember Me" Option**: Extend session duration
3. **Add Activity Tracking**: Refresh on user activity
4. **Add Session Monitoring**: Log session events for debugging
5. **Add Multi-Device Support**: Handle multiple active sessions
