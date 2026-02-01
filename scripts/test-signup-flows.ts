/**
 * Test script to verify all signup flows
 * Run with: npx tsx scripts/test-signup-flows.ts
 * 
 * This script tests the signup API routes directly
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'

interface TestResult {
  test: string
  passed: boolean
  error?: string
  data?: any
}

const results: TestResult[] = []

async function testSignup(
  name: string,
  userType: 'community_builder' | 'venue_owner' | 'vendor',
  payload: any
): Promise<TestResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userType,
        ...payload,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        test: name,
        passed: false,
        error: data.error || `HTTP ${response.status}`,
      }
    }

    if (!data.success || !data.user) {
      return {
        test: name,
        passed: false,
        error: 'Response missing success or user data',
        data,
      }
    }

    return {
      test: name,
      passed: true,
      data: {
        userId: data.user.id,
        email: data.user.email,
      },
    }
  } catch (error) {
    return {
      test: name,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

async function runTests() {
  console.log('🧪 Starting Signup Flow Tests...\n')
  console.log(`API Base URL: ${API_BASE_URL}\n`)

  // Test 1: Community Builder
  const timestamp = Date.now()
  const builderEmail = `test-builder-${timestamp}@example.com`
  
  console.log('📝 Test 1: Community Builder Signup')
  const builderResult = await testSignup(
    'Community Builder Signup',
    'community_builder',
    {
      email: builderEmail,
      password: 'TestPassword123!',
      name: 'Test Builder',
    }
  )
  results.push(builderResult)
  console.log(builderResult.passed ? '✅ PASSED' : `❌ FAILED: ${builderResult.error}\n`)

  // Test 2: Venue Owner
  const venueEmail = `test-venue-${timestamp}@example.com`
  
  console.log('📝 Test 2: Venue Owner Signup')
  const venueResult = await testSignup(
    'Venue Owner Signup',
    'venue_owner',
    {
      email: venueEmail,
      password: 'TestPassword123!',
      name: 'John Doe',
      venue_name: 'Test Venue',
      venue_type: 'loft_warehouse',
      capacity: 100,
      phone: '5551234567',
    }
  )
  results.push(venueResult)
  console.log(venueResult.passed ? '✅ PASSED' : `❌ FAILED: ${venueResult.error}\n`)

  // Test 3: Vendor
  const vendorEmail = `test-vendor-${timestamp}@example.com`
  
  console.log('📝 Test 3: Vendor Signup')
  const vendorResult = await testSignup(
    'Vendor Signup',
    'vendor',
    {
      email: vendorEmail,
      password: 'TestPassword123!',
      name: 'Jane Smith',
      business_name: 'Test Catering Co',
      service_type: 'catering',
      service_area: 'San Francisco, CA',
      phone: '5559876543',
    }
  )
  results.push(vendorResult)
  console.log(vendorResult.passed ? '✅ PASSED' : `❌ FAILED: ${vendorResult.error}\n`)

  // Test 4: Validation - Missing required fields
  console.log('📝 Test 4: Validation - Missing Fields')
  const validationResult = await testSignup(
    'Validation Test',
    'community_builder',
    {
      email: '', // Missing email
      password: 'TestPassword123!',
      name: 'Test User',
    }
  )
  // This should fail, so we check if it properly returns an error
  const validationPassed = Boolean(!validationResult.passed && validationResult.error)
  results.push({
    test: 'Validation Test',
    passed: validationPassed,
    error: validationPassed ? undefined : 'Should have failed validation',
  })
  console.log(validationPassed ? '✅ PASSED' : `❌ FAILED\n`)

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('📊 Test Summary')
  console.log('='.repeat(50))
  
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`📈 Total: ${results.length}`)
  
  if (failed > 0) {
    console.log('\n❌ Failed Tests:')
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.test}: ${r.error}`)
      })
  }
  
  console.log('\n' + '='.repeat(50))
  
  process.exit(failed > 0 ? 1 : 0)
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
