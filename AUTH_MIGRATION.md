# Authentication System Migration to API Routes

This document outlines the migration of the authentication system from direct Supabase client calls to API routes, following the same pattern as the signup flow.

## ✅ Completed Changes

### 1. API Routes Created

#### `/app/api/auth/login/route.ts`
- **Method**: POST
- **Purpose**: Handle email/password authentication
- **Features**:
  - Validates email and password
  - Uses Supabase server client for authentication
  - Returns user type and dashboard path
  - Proper error handling:
    - Invalid credentials: "Email or password incorrect"
    - Network errors: "Connection failed. Please try again."
    - Generic errors: "Something went wrong. Please contact support."
- **Response**:
  ```json
  {
    "success": true,
    "user": {
      "id": "user-uuid",
      "email": "user@example.com",
      "userType": "community_builder"
    },
    "dashboardPath": "/builder",
    "session": {
      "access_token": "...",
      "refresh_token": "..."
    }
  }
  ```

#### `/app/api/auth/logout/route.ts`
- **Method**: POST
- **Purpose**: Sign out the current user
- **Features**:
  - Clears Supabase session
  - Returns success response
  - Proper error handling

#### `/app/api/auth/callback/route.ts` (Updated)
- **Method**: GET
- **Purpose**: Handle OAuth callbacks (Google, Apple, etc.)
- **Features**:
  - Exchanges OAuth code for session
  - Determines user type from metadata or profile
  - Redirects to appropriate dashboard based on user type
  - Handles OAuth errors gracefully
  - Redirects to login with error messages if authentication fails

### 2. Client Components Updated

#### `/app/(auth)/login/page.tsx`
- ✅ Removed `import { signIn, getUserType } from '@/lib/auth'`
- ✅ Removed direct Supabase client usage for login
- ✅ Now calls `/api/auth/login` via `fetch`
- ✅ Google OAuth still uses client-side Supabase (safe for OAuth)
- ✅ Proper error handling with user-friendly messages
- ✅ Handles error messages from URL params (OAuth errors)
- ✅ Redirects to appropriate dashboard based on API response

#### `/components/shared/Header.tsx`
- ✅ Removed `import { signOut } from '@/lib/auth'`
- ✅ Now calls `/api/auth/logout` via `fetch`
- ✅ Proper error handling

## 🔒 Security Improvements

1. **Server-Side Authentication**: All authentication logic now runs on the server
2. **No Client-Side Secrets**: Client components never access server-side Supabase utilities
3. **Proper Session Management**: Sessions are managed server-side
4. **Error Handling**: User-friendly error messages without exposing internal details

## 📋 Error Messages

### Login Errors
- **401 Unauthorized**: "Email or password incorrect"
- **503 Service Unavailable**: "Connection failed. Please try again."
- **500 Internal Server Error**: "Something went wrong. Please contact support."
- **Network Errors**: "Connection failed. Please check your internet and try again."

### OAuth Errors
- **Missing Code**: Redirects to login with error message
- **Session Exchange Failed**: Redirects to login with error message
- **OAuth Provider Error**: Redirects to login with provider error message

## 🧪 Testing

### Test Login API
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Test Logout API
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json"
```

## 🔄 Migration Pattern

All authentication operations now follow this pattern:

### Before (Client-Side Direct Calls)
```typescript
// ❌ DON'T DO THIS IN CLIENT COMPONENTS
import { signIn } from '@/lib/auth'
const { user, error } = await signIn(email, password)
```

### After (API Route Pattern)
```typescript
// ✅ DO THIS IN CLIENT COMPONENTS
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const result = await response.json()
```

## 📝 Remaining Work

### Client Components Still Using Direct Auth
Check these files for any remaining direct Supabase auth calls:
- Components that check authentication status
- Components that refresh sessions
- Any other auth-related operations

### Safe Client-Side Operations
These operations are **safe** to use client-side:
- ✅ `supabase.auth.signInWithOAuth()` - OAuth redirects
- ✅ Reading session from cookies (via middleware)
- ✅ Checking if user is authenticated (via API route)

## 🚀 Next Steps

1. **Update any remaining components** that use `signIn`, `signOut`, or `getUserType` from `@/lib/auth`
2. **Create API route for checking auth status** if needed
3. **Update middleware** to work with new API routes
4. **Add tests** for all API routes
5. **Update documentation** with new authentication flow

## 📚 Related Files

- `/app/api/auth/signup/route.ts` - Signup API route (reference implementation)
- `/app/(auth)/signup/page.tsx` - Signup page (reference implementation)
- `/lib/supabase/server.ts` - Server-side Supabase client
- `/lib/supabase/client.ts` - Client-side Supabase client (for OAuth only)
