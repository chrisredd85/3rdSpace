# Messaging System

This document outlines the messaging system implementation with proper server/client separation and real-time updates.

## ✅ Implementation Summary

### API Routes

#### `/app/api/messages/threads/route.ts`
- **Method**: GET
- **Purpose**: Fetch all message threads for current user
- **Features**:
  - Returns threads where user is participant_1 or participant_2
  - Includes last message for each thread
  - Includes unread count per thread
  - Includes other participant's profile
  - Sorted by last_message_at descending
- **Response**:
  ```json
  {
    "threads": [
      {
        "id": "thread-uuid",
        "participant_1_id": "...",
        "participant_2_id": "...",
        "event_id": "...",
        "venue_booking_id": "...",
        "vendor_booking_id": "...",
        "last_message_at": "2024-01-15T10:00:00Z",
        "last_message": { ... },
        "unread_count": 3,
        "other_participant": { ... }
      }
    ],
    "count": 5
  }
  ```

#### `/app/api/messages/threads/[threadId]/route.ts`
- **Method**: GET
- **Purpose**: Fetch all messages in a thread
- **Features**:
  - Verifies user is a participant
  - Returns all messages with sender profiles
  - Automatically marks messages as read when fetched
  - Updates read_at timestamp
- **Response**:
  ```json
  {
    "thread": { ... },
    "messages": [
      {
        "id": "message-uuid",
        "thread_id": "...",
        "sender_id": "...",
        "content": "Hello!",
        "is_read": true,
        "read_at": "2024-01-15T10:00:00Z",
        "created_at": "2024-01-15T09:00:00Z",
        "profiles": { ... }
      }
    ],
    "count": 10
  }
  ```

#### `/app/api/messages/send/route.ts`
- **Method**: POST
- **Purpose**: Send a new message
- **Body**:
  ```json
  {
    "thread_id": "thread-uuid",
    "content": "Message content"
  }
  ```
- **Features**:
  - Creates message record
  - Updates thread last_message_at
  - Returns message with sender profile
- **Response**:
  ```json
  {
    "success": true,
    "message": {
      "id": "message-uuid",
      "thread_id": "...",
      "sender_id": "...",
      "content": "...",
      "is_read": false,
      "read_at": null,
      "created_at": "...",
      "profiles": { ... }
    }
  }
  ```

#### `/app/api/messages/threads/create/route.ts`
- **Method**: POST
- **Purpose**: Create new message thread
- **Body**:
  ```json
  {
    "participant_2_id": "user-uuid",
    "event_id": "event-uuid (optional)",
    "venue_booking_id": "booking-uuid (optional)",
    "vendor_booking_id": "booking-uuid (optional)"
  }
  ```
- **Features**:
  - Checks if thread already exists between participants
  - Returns existing thread if found
  - Creates new thread if not found
  - Links to booking_id and event_id
  - Sets participant_1 (current user) and participant_2
- **Response**:
  ```json
  {
    "success": true,
    "thread": { ... },
    "isNew": true
  }
  ```

### Hooks (`/lib/hooks/useMessages.ts`)

#### `useThreads()`
- Fetches from `/api/messages/threads`
- Returns threads with last message, unread count, and other participant
- Real-time subscription to `message_threads` table
- Auto-refetches every 60 seconds

#### `useMessages(threadId)`
- Fetches from `/api/messages/threads/[threadId]`
- Returns thread and all messages with sender profiles
- Real-time subscription to `messages` table for the thread
- Optimistically adds new messages to cache
- Updates read status in real-time

#### `useSendMessage()`
- POST to `/api/messages/send`
- Optimistically adds message to cache
- Invalidates queries on success
- Returns created message with sender profile

#### `useUnreadCount()`
- Calculates total unread count from threads
- Uses `useThreads()` data
- Returns `{ unreadCount: number, isLoading: boolean }`

#### `useCreateThread()`
- POST to `/api/messages/threads/create`
- Creates or returns existing thread
- Invalidates threads query on success

## 🔄 Real-Time Updates

### Supabase Realtime Subscriptions

**Thread Updates:**
- Subscribes to `message_threads` table changes
- Invalidates threads query on any change
- Updates UI automatically when threads are created/updated

**Message Updates:**
- Subscribes to `messages` table for specific thread
- Listens for INSERT events (new messages)
- Listens for UPDATE events (read status changes)
- Optimistically updates cache for instant UI feedback

**Implementation:**
```typescript
useEffect(() => {
  const supabase = createClient()
  const channel = supabase
    .channel(`messages:${threadId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `thread_id=eq.${threadId}`,
    }, (payload) => {
      // Update cache optimistically
      queryClient.setQueryData(...)
    })
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [threadId, queryClient])
```

## 🛡️ Security Features

1. **Authentication Required**: All routes verify user is authenticated
2. **Authorization**: Routes verify user is a participant in threads
3. **Server-Side Validation**: All message content validated server-side
4. **Read Status Management**: Messages automatically marked as read when fetched
5. **No Client-Side Secrets**: Client components never access Supabase directly

## 📋 Message Flow

### Sending a Message:
1. User types message and clicks send
2. `useSendMessage()` mutation called
3. POST to `/api/messages/send`
4. Server creates message record
5. Server updates thread `last_message_at`
6. Message returned with sender profile
7. Cache updated optimistically
8. Real-time subscription broadcasts to other participant

### Receiving a Message:
1. Real-time subscription detects new message
2. Cache updated optimistically
3. UI updates immediately
4. Query invalidated to refetch with full data
5. Unread count updated

### Opening a Thread:
1. User clicks on thread
2. `useMessages(threadId)` fetches messages
3. GET `/api/messages/threads/[threadId]`
4. Server marks all unread messages as read
5. Messages returned with sender profiles
6. Real-time subscription set up for thread

## 🧪 Testing

### Test Get Threads
```bash
curl http://localhost:3000/api/messages/threads \
  -H "Cookie: sb-<project>-auth-token=..."
```

### Test Get Messages
```bash
curl http://localhost:3000/api/messages/threads/[threadId] \
  -H "Cookie: sb-<project>-auth-token=..."
```

### Test Send Message
```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-<project>-auth-token=..." \
  -d '{
    "thread_id": "thread-uuid",
    "content": "Hello!"
  }'
```

### Test Create Thread
```bash
curl -X POST http://localhost:3000/api/messages/threads/create \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-<project>-auth-token=..." \
  -d '{
    "participant_2_id": "user-uuid",
    "event_id": "event-uuid"
  }'
```

## 🔍 Usage Examples

### Fetch Threads
```typescript
const { data: threads, isLoading } = useThreads()
```

### Fetch Messages in Thread
```typescript
const { data, isLoading } = useMessages(threadId)
const { thread, messages } = data || {}
```

### Send Message
```typescript
const sendMessage = useSendMessage()

sendMessage.mutate({
  thread_id: threadId,
  content: "Hello!",
})
```

### Get Unread Count
```typescript
const { unreadCount, isLoading } = useUnreadCount()
```

### Create Thread
```typescript
const createThread = useCreateThread()

createThread.mutate({
  participant_2_id: userId,
  event_id: eventId,
})
```

## 🚀 Benefits

1. **Real-Time Updates**: Messages appear instantly via Supabase Realtime
2. **Optimistic Updates**: UI updates immediately before server confirmation
3. **Server/Client Separation**: All database logic on server
4. **Automatic Read Status**: Messages marked as read when viewed
5. **Efficient Caching**: React Query handles caching and invalidation
6. **Type Safety**: Full TypeScript support
7. **Error Handling**: Centralized error handling in API routes

## 📝 Database Schema

### message_threads
- `id`: UUID
- `participant_1_id`: UUID
- `participant_2_id`: UUID
- `event_id`: UUID (nullable)
- `venue_booking_id`: UUID (nullable)
- `vendor_booking_id`: UUID (nullable)
- `last_message_at`: Timestamp (nullable)
- `created_at`: Timestamp
- `updated_at`: Timestamp

### messages
- `id`: UUID
- `thread_id`: UUID
- `sender_id`: UUID
- `content`: Text
- `is_read`: Boolean
- `read_at`: Timestamp (nullable)
- `created_at`: Timestamp

## 🔄 Migration Notes

### Before (Direct Supabase Calls)
```typescript
// ❌ DON'T DO THIS
const { data } = await supabase
  .from('messages')
  .select('*')
  .eq('thread_id', threadId)
```

### After (API Routes)
```typescript
// ✅ DO THIS
const response = await fetch(`/api/messages/threads/${threadId}`, {
  credentials: 'include',
})
const { messages } = await response.json()
```

## 🎯 Next Steps

1. **Add message attachments** (images, files)
2. **Add typing indicators** (real-time)
3. **Add message reactions** (emojis)
4. **Add message search** (full-text search)
5. **Add message deletion** (soft delete)
6. **Add read receipts** (detailed read status)
7. **Add message forwarding** (share messages)
