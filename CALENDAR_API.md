# Calendar API Routes

This document outlines the calendar functionality implementation with proper server/client separation.

## ✅ Implementation Summary

### Venue Calendar Routes

#### `/app/api/venue/availability/route.ts`
- **Method**: GET
- **Purpose**: Fetch availability for a month
- **Query Params**: `year`, `month`
- **Returns**:
  ```json
  {
    "bookings": [...],
    "blocks": [...],
    "availableDates": ["2024-01-15", ...],
    "bookedDates": ["2024-01-20", ...],
    "blockedDates": ["2024-01-25", ...],
    "month": { "year": 2024, "month": 1 }
  }
  ```
- **Features**:
  - Returns bookings (confirmed/pending) for the month
  - Returns availability blocks
  - Calculates available dates (not booked or blocked)
  - Only returns data for authenticated venue owner

#### `/app/api/venue/blocks/route.ts`
- **GET**: Fetch all blocked dates for user's venues
- **POST**: Create new block
  - Validates: end_date > start_date
  - Checks for overlapping bookings
  - Returns created block
- **Body**:
  ```json
  {
    "venue_id": "uuid",
    "start_date": "2024-01-15",
    "end_date": "2024-01-20",
    "start_time": "09:00",
    "end_time": "17:00",
    "is_available": false,
    "reason": "Maintenance"
  }
  ```

#### `/app/api/venue/blocks/[id]/route.ts`
- **PATCH**: Update block
  - Only if block owner matches current user
  - Validates dates
- **DELETE**: Delete block
  - Only if block owner matches current user

### Vendor Calendar Routes

#### `/app/api/vendor/availability/route.ts`
- **Method**: GET
- **Purpose**: Fetch vendor availability for a month
- **Query Params**: `year`, `month`
- **Returns**: Same structure as venue availability
- **Features**:
  - Returns vendor bookings (confirmed/pending)
  - Returns availability blocks
  - Calculates available dates

#### `/app/api/vendor/blocks/route.ts`
- **GET**: Fetch all blocked dates for user's vendor
- **POST**: Create new block
  - Validates: end_date > start_date
  - Checks for overlapping bookings

#### `/app/api/vendor/blocks/[id]/route.ts`
- **PATCH**: Update block
- **DELETE**: Delete block

## 🔄 Updated Hooks

### `useVenueAvailability(year, month)`
- Fetches from `/api/venue/availability`
- Returns full availability data including bookings, blocks, and available dates
- Uses React Query for caching (30 seconds)
- Optimized for calendar display

### `useVendorAvailability(year, month)`
- Fetches from `/api/vendor/availability`
- Same structure as venue availability
- Uses React Query for caching

### `useAvailabilityBlocks()` (Updated)
- Now uses API routes internally
- Maintains backward compatibility
- Deprecated in favor of `useVenueAvailability` or `useVendorAvailability`

### `useCreateAvailabilityBlock()` (Updated)
- POST to `/api/venue/blocks` or `/api/vendor/blocks`
- Optimistic updates
- Validates dates and checks for overlaps

### `useUpdateAvailabilityBlock()` (Updated)
- PATCH to `/api/venue/blocks/[id]` or `/api/vendor/blocks/[id]`
- Optimistic updates
- Only updates blocks owned by user

### `useDeleteAvailabilityBlock()` (Updated)
- DELETE to `/api/venue/blocks/[id]` or `/api/vendor/blocks/[id]`
- Optimistic updates
- Only deletes blocks owned by user

## 🛡️ Security Features

1. **Authentication Required**: All routes verify user is authenticated
2. **User Type Verification**: Routes verify correct user type (venue_owner/vendor)
3. **Authorization**: Routes verify resources belong to user
4. **Date Validation**: Server validates end_date > start_date
5. **Overlap Prevention**: Server checks for overlapping bookings before creating blocks
6. **Server-Side Validation**: All validation happens server-side

## 📋 Validation Rules

### Block Creation:
- ✅ `end_date` must be after `start_date`
- ✅ No overlapping with existing bookings (pending or confirmed)
- ✅ Venue/vendor must belong to authenticated user
- ✅ Dates must be valid ISO format

### Block Update:
- ✅ Block must belong to user's venue/vendor
- ✅ If dates updated, must validate end_date > start_date
- ✅ Cannot create overlaps with bookings

## 🧪 Testing

### Test Venue Availability
```bash
curl "http://localhost:3000/api/venue/availability?year=2024&month=1" \
  -H "Cookie: sb-<project>-auth-token=..."
```

### Test Create Block
```bash
curl -X POST http://localhost:3000/api/venue/blocks \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-<project>-auth-token=..." \
  -d '{
    "venue_id": "venue-uuid",
    "start_date": "2024-01-15",
    "end_date": "2024-01-20",
    "is_available": false,
    "reason": "Maintenance"
  }'
```

### Test Update Block
```bash
curl -X PATCH http://localhost:3000/api/venue/blocks/[id] \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-<project>-auth-token=..." \
  -d '{
    "start_date": "2024-01-16",
    "end_date": "2024-01-21"
  }'
```

### Test Delete Block
```bash
curl -X DELETE http://localhost:3000/api/venue/blocks/[id] \
  -H "Cookie: sb-<project>-auth-token=..."
```

## 🔍 Usage Examples

### Fetch Venue Availability
```typescript
const { data, isLoading } = useVenueAvailability(2024, 1)
const { bookings, blocks, availableDates } = data || {}
```

### Create Block
```typescript
const createBlock = useCreateAvailabilityBlock()

createBlock.mutate({
  venue_id: venueId,
  start_date: "2024-01-15",
  end_date: "2024-01-20",
  is_available: false,
  reason: "Maintenance",
})
```

### Update Block
```typescript
const updateBlock = useUpdateAvailabilityBlock()

updateBlock.mutate({
  id: blockId,
  isVenue: true,
  updates: {
    start_date: "2024-01-16",
    end_date: "2024-01-21",
  },
})
```

### Delete Block
```typescript
const deleteBlock = useDeleteAvailabilityBlock()

deleteBlock.mutate({
  id: blockId,
  isVenue: true,
})
```

## 🚀 Benefits

1. **Server/Client Separation**: All database logic on server
2. **Optimistic Updates**: UI updates immediately before server confirmation
3. **Efficient Caching**: React Query handles caching (30 seconds)
4. **Date Calculation**: Server calculates available dates
5. **Overlap Prevention**: Server prevents conflicting blocks
6. **Type Safety**: Full TypeScript support
7. **Error Handling**: Centralized error handling in API routes

## 📝 Calendar Component Updates

### Before (Direct Supabase Calls)
```typescript
// ❌ DON'T DO THIS
const { data } = await supabase
  .from('availability_blocks')
  .select('*')
  .eq('venue_id', venueId)
```

### After (API Routes)
```typescript
// ✅ DO THIS
const { data } = useVenueAvailability(year, month)
const { blocks, bookings, availableDates } = data || {}
```

## 🔄 Migration Notes

1. **Calendar components** continue to work with `useAvailabilityBlocks()` (backward compatible)
2. **New components** should use `useVenueAvailability()` or `useVendorAvailability()` directly
3. **All mutations** now use API routes automatically
4. **Loading states** handled by React Query
5. **Optimistic updates** work automatically

## 🎯 Next Steps

1. **Update calendar components** to use `useVenueAvailability()` directly
2. **Add real-time subscriptions** for availability changes
3. **Add bulk block operations** (block multiple dates at once)
4. **Add recurring blocks** (weekly, monthly patterns)
5. **Add availability templates** (predefined block patterns)
