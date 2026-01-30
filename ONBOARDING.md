# Onboarding System

This document outlines the onboarding flow for new users after signup.

## ✅ Implementation Summary

### 1. Onboarding Page (`/app/(auth)/onboarding/page.tsx`)

**Features:**
- ✅ Fetches `user_type` from session using `useUser` hook
- ✅ Shows appropriate setup form based on user type
- ✅ Checks if user has already completed onboarding
- ✅ Redirects to dashboard if onboarding already complete
- ✅ Redirects to login if not authenticated

**User Type Forms:**

#### Venue Owners
- Venue name *
- Address *
- City *
- State *
- ZIP Code *
- Venue type * (dropdown)
- Capacity *
- Venue photo (optional, file upload)

#### Vendors
- Business name *
- Service type * (dropdown)
- Service area *
- Setup time required * (30min/60min/90min/2hr/3hr)
- Description (optional)

#### Community Builders
- Company/Organization name (optional)
- Can skip onboarding and start creating events immediately

### 2. API Routes

#### `/app/api/onboarding/venue/route.ts`
- **Method**: POST
- **Purpose**: Complete venue owner onboarding
- **Features**:
  - Validates user is authenticated and is a venue owner
  - Creates or updates venue record in `venues` table
  - Handles photo upload to Supabase Storage
  - Creates venue photo record
  - Links venue to user via `owner_id`
  - Sets `is_active = true` after onboarding

**Request (FormData):**
```
venue_name: string
address: string
city: string
state: string
zip_code: string
venue_type: VenueType
capacity: number
photo?: File
```

**Response:**
```json
{
  "success": true,
  "venueId": "venue-uuid",
  "message": "Venue profile created successfully"
}
```

#### `/app/api/onboarding/vendor/route.ts`
- **Method**: POST
- **Purpose**: Complete vendor onboarding
- **Features**:
  - Validates user is authenticated and is a vendor
  - Creates or updates vendor record in `vendors` table
  - Stores service_area in address field
  - Stores setup_time in description
  - Links vendor to user via `owner_id`
  - Sets `is_active = true` after onboarding

**Request (JSON):**
```json
{
  "business_name": "string",
  "service_type": "ServiceType",
  "service_area": "string",
  "setup_time": "30min" | "60min" | "90min" | "2hr" | "3hr",
  "description": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "vendorId": "vendor-uuid",
  "message": "Vendor profile created successfully"
}
```

#### `/app/api/onboarding/check/route.ts`
- **Method**: GET
- **Purpose**: Check if user has completed onboarding
- **Features**:
  - Returns onboarding status based on user type
  - Community builders: Always `isOnboarded: true`
  - Venue owners: Checks if venue exists with address
  - Vendors: Checks if vendor exists with service_type

**Response:**
```json
{
  "isOnboarded": true | false,
  "userType": "UserType",
  "hasVenue": true | false, // for venue owners
  "hasVendor": true | false  // for vendors
}
```

### 3. Signup Flow Updates

**Updated redirects:**
- ✅ All signup forms now redirect to `/onboarding` instead of dashboard
- ✅ Builder signup → `/onboarding`
- ✅ Venue signup → `/onboarding`
- ✅ Vendor signup → `/onboarding`

### 4. Middleware Updates

- ✅ `/onboarding` route requires authentication
- ✅ Allows access to onboarding API routes
- ✅ Redirects authenticated users away from login/signup

## 🔄 Onboarding Flow

### For Venue Owners:
1. User signs up → Redirected to `/onboarding`
2. Fills out venue form (name, address, type, capacity, photo)
3. Submits form → Calls `/api/onboarding/venue`
4. API creates/updates venue record
5. Uploads photo to Supabase Storage (if provided)
6. Redirects to `/venue` dashboard

### For Vendors:
1. User signs up → Redirected to `/onboarding`
2. Fills out vendor form (business name, service type, area, setup time)
3. Submits form → Calls `/api/onboarding/vendor`
4. API creates/updates vendor record
5. Redirects to `/vendor` dashboard

### For Community Builders:
1. User signs up → Redirected to `/onboarding`
2. Optional: Enter company name
3. Can skip or submit → Redirects to `/builder` dashboard
4. Can start creating events immediately

## 🛡️ Security & Validation

1. **Authentication Required**: All onboarding routes require authentication
2. **User Type Verification**: API routes verify user type matches the onboarding form
3. **Form Validation**: Zod schemas validate all input fields
4. **Duplicate Prevention**: API routes check for existing records and update instead of creating duplicates
5. **Photo Upload Security**: Photos uploaded to Supabase Storage with proper paths

## 📋 Database Updates

### Venues Table
- Creates/updates record with:
  - `owner_id`: User ID
  - `name`: Venue name
  - `address`, `city`, `state`, `zip_code`: Location
  - `venue_type`: Type of venue
  - `capacity`: Maximum capacity
  - `is_active`: Set to `true` after onboarding
  - `is_verified`: Set to `false` (requires admin verification)

### Vendors Table
- Creates/updates record with:
  - `owner_id`: User ID
  - `name`, `business_name`: Business information
  - `service_type`: Type of service
  - `description`: Includes setup time
  - `address`: Stores service area
  - `is_active`: Set to `true` after onboarding
  - `is_verified`: Set to `false` (requires admin verification)

### Venue Photos Table
- Creates record for uploaded photo:
  - `venue_id`: Links to venue
  - `photo_url`: Public URL from Supabase Storage
  - `is_primary`: Set to `true` for first photo
  - `display_order`: Set to `0`

## 🧪 Testing

### Test Venue Onboarding
```bash
# After signing up as venue owner, navigate to /onboarding
# Fill out form and submit
# Verify venue record created in database
# Verify redirect to /venue dashboard
```

### Test Vendor Onboarding
```bash
# After signing up as vendor, navigate to /onboarding
# Fill out form and submit
# Verify vendor record created in database
# Verify redirect to /vendor dashboard
```

### Test Onboarding Check
```bash
curl http://localhost:3000/api/onboarding/check \
  -H "Cookie: sb-<project>-auth-token=..."
```

## 🔍 Onboarding Status Logic

**Community Builders:**
- Always considered onboarded (no additional setup needed)
- Can skip onboarding form

**Venue Owners:**
- Onboarded if: Venue record exists AND has address
- Check: `SELECT * FROM venues WHERE owner_id = ? AND address IS NOT NULL`

**Vendors:**
- Onboarded if: Vendor record exists AND has service_type
- Check: `SELECT * FROM vendors WHERE owner_id = ? AND service_type IS NOT NULL`

## 🚀 Next Steps

1. **Add onboarding progress indicator** (optional)
2. **Add ability to skip onboarding** (with reminder to complete later)
3. **Add onboarding completion notification** to admin
4. **Add onboarding analytics** (track completion rates)
5. **Add multi-step onboarding** for complex profiles (optional)
