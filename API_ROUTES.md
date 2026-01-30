# Dashboard API Routes

This document outlines all API routes for dashboard data, maintaining strict server/client separation.

## ✅ Implementation Summary

### Builder Dashboard Routes

#### `/app/api/builder/stats/route.ts`
- **Method**: GET
- **Purpose**: Fetch builder dashboard statistics
- **Returns**:
  ```json
  {
    "upcomingEvents": 5,
    "activeVendors": 12,
    "savedVendors": 8,
    "savedVenues": 3,
    "ytdSpend": 45000,
    "eventsThisYear": 15,
    "totalEvents": 42
  }
  ```
- **Authentication**: Requires community_builder user type
- **Data Sources**: `events`, `saved_vendors`, `saved_venues`, `vendor_bookings` tables

#### `/app/api/builder/events/route.ts`
- **GET**: List user's events with filtering/sorting
  - Query params: `status`, `limit`, `offset`
  - Returns: `{ events: Event[], count: number }`
- **POST**: Create new event
  - Body: Event data (title, description, event_date, etc.)
  - Returns: `{ success: true, event: Event }`
- **Authentication**: Requires community_builder user type

#### `/app/api/builder/events/[id]/route.ts`
- **GET**: Single event details with venue and vendors
  - Returns: `{ event: EventWithRelations }`
- **PATCH**: Update event
  - Body: Partial event data
  - Returns: `{ success: true, event: Event }`
- **DELETE**: Delete event
  - Returns: `{ success: true, message: string }`
- **Authentication**: Requires community_builder user type
- **Authorization**: Verifies event belongs to user

### Venue Dashboard Routes

#### `/app/api/venue/requests/route.ts`
- **Method**: GET
- **Purpose**: Fetch venue booking requests
- **Query Params**: `status` (pending/confirmed/declined/all)
- **Returns**:
  ```json
  {
    "bookings": [
      {
        "id": "...",
        "status": "pending",
        "events": { ... },
        "venues": { ... }
      }
    ],
    "count": 5
  }
  ```
- **Authentication**: Requires venue_owner user type
- **Includes**: Event details, organizer profile, venue details

#### `/app/api/venue/bookings/[id]/route.ts`
- **Method**: PATCH
- **Purpose**: Accept/decline booking request
- **Body**:
  ```json
  {
    "status": "confirmed" | "declined",
    "confirmed_date": "2024-01-15",
    "confirmed_start_time": "18:00",
    "confirmed_end_time": "22:00",
    "final_price": 5000,
    "quoted_price": 5000,
    "notes": "Optional notes"
  }
  ```
- **Features**:
  - Updates booking status
  - Creates message thread automatically if confirmed/declined
  - Sends notification to organizer
- **Authentication**: Requires venue_owner user type
- **Authorization**: Verifies booking belongs to user's venue

### Vendor Dashboard Routes

#### `/app/api/vendor/bookings/route.ts`
- **Method**: GET
- **Purpose**: Fetch vendor booking requests
- **Query Params**: `status` (pending/confirmed/declined/all)
- **Returns**:
  ```json
  {
    "bookings": [
      {
        "id": "...",
        "status": "pending",
        "events": { ... },
        "vendors": { ... }
      }
    ],
    "count": 3
  }
  ```
- **Authentication**: Requires vendor user type
- **Includes**: Event details, organizer profile, venue details, vendor details

## 🔄 Updated Hooks

### `useBuilderStats()`
- Fetches from `/api/builder/stats`
- Uses React Query for caching (5 minutes)
- Returns dashboard statistics

### `useEvents(organizerId, filters?)`
- **GET**: Fetches from `/api/builder/events`
- Supports filtering by status, pagination
- Returns list of events

### `useEvent(id)`
- **GET**: Fetches from `/api/builder/events/[id]`
- Returns single event with relations (venue, vendors, bookings)

### `useCreateEvent()`
- **POST**: Creates event via `/api/builder/events`
- Optimistic updates with React Query
- Invalidates related queries on success

### `useUpdateEvent()`
- **PATCH**: Updates event via `/api/builder/events/[id]`
- Optimistic updates
- Invalidates event and progress queries

### `useDeleteEvent()`
- **DELETE**: Deletes event via `/api/builder/events/[id]`
- Removes event from cache
- Invalidates stats

### `useVenueBookingRequests(venueOwnerId, status?)`
- **GET**: Fetches from `/api/venue/requests`
- Supports status filtering
- Returns booking requests with event and organizer details

### `useUpdateVenueBookingStatus()`
- **PATCH**: Updates booking via `/api/venue/bookings/[id]`
- Handles accept/decline actions
- Creates message thread and notifications automatically

### `useVendorBookingRequests(vendorId, status?)`
- **GET**: Fetches from `/api/vendor/bookings`
- Supports status filtering
- Returns booking requests with event, organizer, and venue details

## 🛡️ Security Features

1. **Authentication Required**: All routes verify user is authenticated
2. **User Type Verification**: Routes verify correct user type (builder/venue/vendor)
3. **Authorization**: Routes verify resources belong to the user
4. **Server-Side Validation**: All data validation happens server-side
5. **No Client-Side Secrets**: Client components never access Supabase directly

## 📋 Error Handling

All API routes return consistent error responses:
```json
{
  "error": "Error message"
}
```

Status codes:
- `401`: Not authenticated
- `403`: Unauthorized (wrong user type or resource ownership)
- `404`: Resource not found
- `400`: Bad request (validation errors)
- `500`: Internal server error

## 🧪 Testing

### Test Builder Stats
```bash
curl http://localhost:3000/api/builder/stats \
  -H "Cookie: sb-<project>-auth-token=..."
```

### Test Events List
```bash
curl "http://localhost:3000/api/builder/events?status=planning&limit=10" \
  -H "Cookie: sb-<project>-auth-token=..."
```

### Test Create Event
```bash
curl -X POST http://localhost:3000/api/builder/events \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-<project>-auth-token=..." \
  -d '{
    "title": "Test Event",
    "event_date": "2024-12-31",
    "budget": 5000
  }'
```

### Test Venue Requests
```bash
curl "http://localhost:3000/api/venue/requests?status=pending" \
  -H "Cookie: sb-<project>-auth-token=..."
```

### Test Update Booking
```bash
curl -X PATCH http://localhost:3000/api/venue/bookings/[id] \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-<project>-auth-token=..." \
  -d '{
    "status": "confirmed",
    "final_price": 5000
  }'
```

## 🔄 Migration Notes

### Before (Direct Supabase Calls)
```typescript
// ❌ DON'T DO THIS
const { data } = await supabase
  .from('events')
  .select('*')
  .eq('builder_id', userId)
```

### After (API Routes)
```typescript
// ✅ DO THIS
const response = await fetch('/api/builder/events', {
  credentials: 'include',
})
const { events } = await response.json()
```

## 📝 Updated Components

- ✅ `/app/(dashboard)/builder/page.tsx` - Uses `useBuilderStats()` hook
- ✅ `/lib/hooks/useEvents.ts` - All methods use API routes
- ✅ `/lib/hooks/useBookings.ts` - Uses API routes for venue bookings
- ✅ `/lib/hooks/useVendorBookings.ts` - Uses API routes for vendor bookings
- ✅ `/lib/hooks/useBuilderStats.ts` - New hook for dashboard stats

## 🚀 Benefits

1. **Server/Client Separation**: All database logic on server
2. **Security**: No client-side Supabase access
3. **Consistency**: Uniform API response format
4. **Caching**: React Query handles caching automatically
5. **Optimistic Updates**: Instant UI feedback
6. **Error Handling**: Centralized error handling
7. **Type Safety**: TypeScript types for all responses

## 🔍 Next Steps

1. **Add vendor booking update route** (similar to venue)
2. **Add pagination metadata** (total count, hasMore, etc.)
3. **Add filtering/sorting** to more endpoints
4. **Add rate limiting** to prevent abuse
5. **Add request logging** for debugging
6. **Add API documentation** (OpenAPI/Swagger)
