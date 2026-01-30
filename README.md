# 3rdSpace - B2B Event Marketplace

A Next.js 14 application connecting community builders, venue owners, and vendors.

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Supabase** (Backend)
- **shadcn/ui** (Component library)
- **React Hook Form + Zod** (Form validation)
- **TanStack Query** (Data fetching)
- **Zustand** (State management)

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env.local
```

Add your Supabase credentials to `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # Optional, for admin operations
```

**Note**: The `SUPABASE_SERVICE_ROLE_KEY` is optional and only needed for server-side admin operations. Keep it secure and never expose it to the client.

3. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
/app
  /(auth)          # Authentication routes
  /(dashboard)     # Dashboard routes for different user types
  /api             # API routes
/components
  /ui              # shadcn/ui components
  /shared          # Shared reusable components
  /builder         # Builder-specific components
  /venue           # Venue-specific components
  /vendor          # Vendor-specific components
/lib
  /supabase        # Supabase client setup
  /types           # TypeScript types
  /utils           # Utility functions
  /hooks           # Custom React hooks
  /store           # Zustand stores
```

## Color System

The project uses a custom color system with CSS variables:
- **Forest Green** (Primary): `#10B981` (forest-500)
- **Gray Scale**: Full range from gray-50 to gray-900
- **Yellow** (Warnings): `#F59E0B`
- **Red** (Errors): `#EF4444`

## Typography

- **Font Family**: Inter
- **Font Sizes**: 13px - 48px scale
- **Font Weights**: 400, 500, 600, 700

## Authentication

The project includes a complete Supabase authentication setup:

### Client Configuration
- **`/lib/supabase/client.ts`**: Browser client for client-side operations
- **`/lib/supabase/server.ts`**: Server client for Server Components and API routes
- **`/lib/supabase/middleware.ts`**: Middleware helpers for route protection

### Authentication Utilities (`/lib/auth.ts`)
- `getCurrentUser()` - Get current authenticated user (client-side)
- `getCurrentUserServer()` - Get current authenticated user (server-side)
- `getUserType()` - Determine if user is builder/venue/vendor
- `signUp()` - Handle user registration with user_type
- `signIn()` - Email/password login
- `signOut()` - Logout functionality
- `updateUserProfile()` - Update user info
- `getUserProfile()` - Get user profile from database

### Route Protection
The middleware automatically protects dashboard routes and redirects unauthenticated users to `/login`. Public routes (`/`, `/login`, `/signup`) are accessible without authentication.

### User Types
Users can have one of three roles:
- **builder**: Community builders who create events
- **venue**: Venue owners who provide spaces
- **vendor**: Vendors who provide services
