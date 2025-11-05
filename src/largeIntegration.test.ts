/**
 * Large Integration Test - RateLimiter Task
 *
 * This test simulates a complete, realistic coding task where an AI model must:
 * 1. Read starter code with TODOs (Python rate limiter class)
 * 2. Read the README with detailed requirements
 * 3. Generate a complete unified diff to implement all functionality
 * 4. Produce code that passes all 13 unit tests
 *
 * This is a comprehensive test that validates:
 * - The model can understand complex requirements from documentation
 * - The model can generate syntactically valid unified diffs
 * - The patch applier can apply the generated diff correctly
 * - The final implementation is functionally correct
 *
 * Run with: npm run test:large
 *
 * The test creates a temporary Python environment, applies the diff,
 * and runs the actual Python unit tests to verify correctness.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { applyPatch } from './patchApplier';
import { execSync } from 'child_process';

// Starter code with TODOs (what the model receives as input)
const STARTER_CODE = `from typing import Dict, Any, Optional


class RateLimiter:
    """Tracks and enforces rate limits for users."""

    def __init__(self, max_requests: int = 100):
        """
        Initialize the rate limiter.

        Args:
            max_requests: Maximum number of requests allowed per user (default: 100)
        """
        # TODO: Store the max_requests limit
        # TODO: Initialize a dictionary to track request counts per user
        pass

    def check_rate_limit(self, user_id: str, request_data: Optional[Dict[str, Any]] = None) -> bool:
        """
        Check if a request should be allowed and increment counter if so.

        Args:
            user_id: Unique identifier for the user
            request_data: Optional dictionary containing request metadata
                         (e.g., {'endpoint': '/api/data', 'method': 'GET', 'ip': '192.168.1.1'})

        Returns:
            True if request is allowed (under limit), False if blocked (at or over limit)
        """
        # TODO: Handle None request_data by setting to empty dict
        # TODO: Get current count for this user (default to 0 if not present)
        # TODO: Check if current count is at or above max_requests
        #       - If so, return False (blocked)
        # TODO: If under limit, increment the counter and return True (allowed)
        pass

    def get_request_count(self, user_id: str) -> int:
        """
        Get the current request count for a user.

        Args:
            user_id: Unique identifier for the user

        Returns:
            Number of requests made by this user
        """
        # TODO: Return the count for this user (default to 0 if not present)
        pass

    def reset_user(self, user_id: str) -> None:
        """
        Reset the request counter for a specific user.

        Args:
            user_id: Unique identifier for the user
        """
        # TODO: Remove this user from the request_counts dictionary
        # Hint: Check if user exists before removing to avoid KeyError
        pass

    def reset_all(self) -> None:
        """Reset all request counters."""
        # TODO: Clear all entries from the request_counts dictionary
        pass


if __name__ == '__main__':
    import unittest
    import sys
    import os

    # Add the test directory to path
    test_dir = os.path.join(os.path.dirname(__file__), 'DO_NOT_OPEN_UNIT_TEST')
    sys.path.insert(0, test_dir)

    # Discover and run tests
    loader = unittest.TestLoader()
    suite = loader.discover(test_dir, pattern='test_*.py')
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(suite)
`;

// README explaining the task
const README = `# Task 1: Simple Rate Counter

## Task Description

Implement a rate limiting python class that tracks how many requests each user has made and enforces a maximum request limit per time window. This is a common security control to prevent abuse of APIs and services.

**Core Functionality:**
- Track request counts for different user identifiers
- Allow or deny requests based on configured limits
- Reset counters when needed
- Handle multiple users independently

**Requirements:**

1. **Rate Limit Tracking**: Count requests per user ID within a time window
   - Each user identified by a unique string identifier (user_id)
   - Track the number of requests made by each user
   - Enforce a configurable maximum request limit

2. **Request Checking**: Determine if a request should be allowed
   - Accept a user_id and optional request_data
   - Return \`True\` if request is allowed (under limit)
   - Return \`False\` if request should be blocked (at or over limit)
   - Increment counter only when request is allowed

3. **Counter Management**:
   - Get current count for any user
   - Reset counter for a specific user
   - Reset all counters

4. **Request Data**: Each request includes optional metadata
   - Request data is a dictionary that may contain: endpoint, method, IP address, timestamp, etc.
   - This data is logged for audit purposes but doesn't affect rate limiting logic

**Technical Specifications:**
- Use a dictionary to store user request counts
- Default rate limit: 100 requests per window
- User IDs are case-sensitive strings
- Request data is optional (defaults to empty dict)
`;

// Unit tests (same as provided)
const UNIT_TESTS = `import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from rate_limiter import RateLimiter


class TestRateLimiter(unittest.TestCase):
    """Test suite for rate limiter."""

    def setUp(self):
        """Set up test fixtures."""
        self.limiter = RateLimiter(max_requests=5)

    def test_first_request_allowed(self):
        """Test that the first request is always allowed."""
        result = self.limiter.check_rate_limit("user1")
        self.assertTrue(result)

    def test_request_count_increments(self):
        """Test that request count increments correctly."""
        user_id = "user2"

        self.limiter.check_rate_limit(user_id)
        self.assertEqual(self.limiter.get_request_count(user_id), 1)

        self.limiter.check_rate_limit(user_id)
        self.assertEqual(self.limiter.get_request_count(user_id), 2)

        self.limiter.check_rate_limit(user_id)
        self.assertEqual(self.limiter.get_request_count(user_id), 3)

    def test_request_blocked_at_limit(self):
        """Test that requests are blocked when limit is reached."""
        user_id = "user3"

        # Make 5 requests (limit is 5)
        for i in range(5):
            result = self.limiter.check_rate_limit(user_id)
            self.assertTrue(result, f"Request {i+1} should be allowed")

        # 6th request should be blocked
        result = self.limiter.check_rate_limit(user_id)
        self.assertFalse(result)

        # Count should stay at 5
        self.assertEqual(self.limiter.get_request_count(user_id), 5)

    def test_multiple_blocked_requests(self):
        """Test that multiple requests stay blocked after limit."""
        user_id = "user4"

        # Reach the limit
        for _ in range(5):
            self.limiter.check_rate_limit(user_id)

        # Multiple requests should all be blocked
        self.assertFalse(self.limiter.check_rate_limit(user_id))
        self.assertFalse(self.limiter.check_rate_limit(user_id))
        self.assertFalse(self.limiter.check_rate_limit(user_id))

        # Count should not increment
        self.assertEqual(self.limiter.get_request_count(user_id), 5)

    def test_multiple_users_independent(self):
        """Test that different users have independent counters."""
        # User 1 makes 3 requests
        for _ in range(3):
            self.limiter.check_rate_limit("user5")

        # User 2 makes 2 requests
        for _ in range(2):
            self.limiter.check_rate_limit("user6")

        # Counts should be independent
        self.assertEqual(self.limiter.get_request_count("user5"), 3)
        self.assertEqual(self.limiter.get_request_count("user6"), 2)

        # Both users should still be able to make more requests
        self.assertTrue(self.limiter.check_rate_limit("user5"))
        self.assertTrue(self.limiter.check_rate_limit("user6"))

    def test_reset_user(self):
        """Test resetting a specific user's counter."""
        user_id = "user7"

        # Make some requests
        for _ in range(3):
            self.limiter.check_rate_limit(user_id)

        self.assertEqual(self.limiter.get_request_count(user_id), 3)

        # Reset this user
        self.limiter.reset_user(user_id)

        # Count should be back to 0
        self.assertEqual(self.limiter.get_request_count(user_id), 0)

        # Should be able to make requests again
        self.assertTrue(self.limiter.check_rate_limit(user_id))
        self.assertEqual(self.limiter.get_request_count(user_id), 1)

    def test_reset_all(self):
        """Test resetting all counters."""
        # Multiple users make requests
        for _ in range(2):
            self.limiter.check_rate_limit("user8")
        for _ in range(3):
            self.limiter.check_rate_limit("user9")
        for _ in range(4):
            self.limiter.check_rate_limit("user10")

        # Reset all
        self.limiter.reset_all()

        # All counts should be 0
        self.assertEqual(self.limiter.get_request_count("user8"), 0)
        self.assertEqual(self.limiter.get_request_count("user9"), 0)
        self.assertEqual(self.limiter.get_request_count("user10"), 0)

    def test_unknown_user_count(self):
        """Test getting count for user who hasn't made requests."""
        count = self.limiter.get_request_count("unknown_user")
        self.assertEqual(count, 0)

    def test_custom_max_requests(self):
        """Test rate limiter with custom max requests."""
        custom_limiter = RateLimiter(max_requests=3)
        user_id = "user11"

        # Should allow 3 requests
        self.assertTrue(custom_limiter.check_rate_limit(user_id))
        self.assertTrue(custom_limiter.check_rate_limit(user_id))
        self.assertTrue(custom_limiter.check_rate_limit(user_id))

        # 4th should be blocked
        self.assertFalse(custom_limiter.check_rate_limit(user_id))

    def test_request_with_metadata(self):
        """Test that request data parameter doesn't affect rate limiting."""
        user_id = "user12"

        request_data_1 = {
            'endpoint': '/api/users',
            'method': 'GET',
            'ip': '192.168.1.100'
        }

        request_data_2 = {
            'endpoint': '/api/posts',
            'method': 'POST',
            'ip': '192.168.1.101',
            'user_agent': 'Mozilla/5.0'
        }

        # Requests with different metadata should still count toward same limit
        self.assertTrue(self.limiter.check_rate_limit(user_id, request_data_1))
        self.assertTrue(self.limiter.check_rate_limit(user_id, request_data_2))
        self.assertTrue(self.limiter.check_rate_limit(user_id, None))

        self.assertEqual(self.limiter.get_request_count(user_id), 3)

    def test_case_sensitive_user_ids(self):
        """Test that user IDs are case-sensitive."""
        self.limiter.check_rate_limit("User13")
        self.limiter.check_rate_limit("user13")
        self.limiter.check_rate_limit("USER13")

        # These should be three different users
        self.assertEqual(self.limiter.get_request_count("User13"), 1)
        self.assertEqual(self.limiter.get_request_count("user13"), 1)
        self.assertEqual(self.limiter.get_request_count("USER13"), 1)

    def test_reset_nonexistent_user(self):
        """Test that resetting a user who hasn't made requests doesn't error."""
        # This should not raise an exception
        self.limiter.reset_user("nonexistent_user")

        # Count should still be 0
        self.assertEqual(self.limiter.get_request_count("nonexistent_user"), 0)

    def test_exact_limit_boundary(self):
        """Test behavior exactly at the limit."""
        user_id = "user14"

        # Make exactly max_requests (5)
        for i in range(5):
            result = self.limiter.check_rate_limit(user_id)
            self.assertTrue(result, f"Request {i+1} at or under limit should be allowed")

        # Next request should fail
        result = self.limiter.check_rate_limit(user_id)
        self.assertFalse(result, "Request over limit should be blocked")

        self.assertEqual(self.limiter.get_request_count(user_id), 5)


if __name__ == '__main__':
    unittest.main()
`;

// Model-generated diff that completes the implementation
const MODEL_GENERATED_DIFF = `--- /tmp/rate_limiter.py
+++ /tmp/rate_limiter.py
@@ -9,8 +9,8 @@ class RateLimiter:
         Args:
             max_requests: Maximum number of requests allowed per user (default: 100)
         """
-        # TODO: Store the max_requests limit
-        # TODO: Initialize a dictionary to track request counts per user
-        pass
+        self.max_requests = max_requests
+        self.request_counts: Dict[str, int] = {}

     def check_rate_limit(self, user_id: str, request_data: Optional[Dict[str, Any]] = None) -> bool:
@@ -25,11 +25,16 @@ class RateLimiter:
         Returns:
             True if request is allowed (under limit), False if blocked (at or over limit)
         """
-        # TODO: Handle None request_data by setting to empty dict
-        # TODO: Get current count for this user (default to 0 if not present)
-        # TODO: Check if current count is at or above max_requests
-        #       - If so, return False (blocked)
-        # TODO: If under limit, increment the counter and return True (allowed)
-        pass
+        if request_data is None:
+            request_data = {}
+
+        current_count = self.request_counts.get(user_id, 0)
+
+        if current_count >= self.max_requests:
+            return False
+
+        self.request_counts[user_id] = current_count + 1
+        return True

     def get_request_count(self, user_id: str) -> int:
@@ -41,8 +46,7 @@ class RateLimiter:
         Returns:
             Number of requests made by this user
         """
-        # TODO: Return the count for this user (default to 0 if not present)
-        pass
+        return self.request_counts.get(user_id, 0)

     def reset_user(self, user_id: str) -> None:
@@ -52,9 +56,8 @@ class RateLimiter:
             user_id: Unique identifier for the user
         """
-        # TODO: Remove this user from the request_counts dictionary
-        # Hint: Check if user exists before removing to avoid KeyError
-        pass
+        if user_id in self.request_counts:
+            del self.request_counts[user_id]

     def reset_all(self) -> None:
@@ -62,8 +65,7 @@ class RateLimiter:
         """Reset all request counters."""
-        # TODO: Clear all entries from the request_counts dictionary
-        pass
+        self.request_counts.clear()


 if __name__ == '__main__':`;

// Expected complete implementation
const EXPECTED_RESULT = `from typing import Dict, Any, Optional


class RateLimiter:
    """Tracks and enforces rate limits for users."""

    def __init__(self, max_requests: int = 100):
        """
        Initialize the rate limiter.

        Args:
            max_requests: Maximum number of requests allowed per user (default: 100)
        """
        self.max_requests = max_requests
        self.request_counts: Dict[str, int] = {}

    def check_rate_limit(self, user_id: str, request_data: Optional[Dict[str, Any]] = None) -> bool:
        """
        Check if a request should be allowed and increment counter if so.

        Args:
            user_id: Unique identifier for the user
            request_data: Optional dictionary containing request metadata
                         (e.g., {'endpoint': '/api/data', 'method': 'GET', 'ip': '192.168.1.1'})

        Returns:
            True if request is allowed (under limit), False if blocked (at or over limit)
        """
        if request_data is None:
            request_data = {}

        current_count = self.request_counts.get(user_id, 0)

        if current_count >= self.max_requests:
            return False

        self.request_counts[user_id] = current_count + 1
        return True

    def get_request_count(self, user_id: str) -> int:
        """
        Get the current request count for a user.

        Args:
            user_id: Unique identifier for the user

        Returns:
            Number of requests made by this user
        """
        return self.request_counts.get(user_id, 0)

    def reset_user(self, user_id: str) -> None:
        """
        Reset the request counter for a specific user.

        Args:
            user_id: Unique identifier for the user
        """
        if user_id in self.request_counts:
            del self.request_counts[user_id]

    def reset_all(self) -> None:
        """Reset all request counters."""
        self.request_counts.clear()


if __name__ == '__main__':
    import unittest
    import sys
    import os

    # Add the test directory to path
    test_dir = os.path.join(os.path.dirname(__file__), 'DO_NOT_OPEN_UNIT_TEST')
    sys.path.insert(0, test_dir)

    # Discover and run tests
    loader = unittest.TestLoader()
    suite = loader.discover(test_dir, pattern='test_*.py')
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(suite)
`;

interface TestResult {
  patchApplied: boolean;
  codeMatches: boolean;
  unittestsPassed: boolean;
  error?: string;
}

/**
 * Run the large integration test
 */
function runLargeIntegrationTest(): TestResult {
  console.log('=' .repeat(80));
  console.log('LARGE INTEGRATION TEST: RateLimiter Implementation');
  console.log('=' .repeat(80));
  console.log();

  // Step 1: Display the task context
  console.log('📋 TASK CONTEXT:');
  console.log('-'.repeat(80));
  console.log('The model receives:');
  console.log('  1. Starter code with TODOs (rate_limiter.py)');
  console.log('  2. README with task requirements');
  console.log('  3. Unit test file (for reference)');
  console.log();
  console.log('The model must:');
  console.log('  - Understand the requirements from the README');
  console.log('  - Generate a unified diff to complete all TODOs');
  console.log('  - Ensure the implementation passes all unit tests');
  console.log();

  // Step 2: Apply the model-generated diff
  console.log('🔧 APPLYING MODEL-GENERATED DIFF:');
  console.log('-'.repeat(80));

  const patchResult = applyPatch(STARTER_CODE, MODEL_GENERATED_DIFF);

  if (!patchResult.success) {
    console.log('❌ FAIL: Patch application failed');
    console.log('Error:', patchResult.error);
    return {
      patchApplied: false,
      codeMatches: false,
      unittestsPassed: false,
      error: patchResult.error,
    };
  }

  console.log('✓ Patch applied successfully');
  console.log();

  // Step 3: Verify the code matches expected result
  console.log('🔍 VERIFYING CODE CORRECTNESS:');
  console.log('-'.repeat(80));

  const codeMatches = patchResult.newContent === EXPECTED_RESULT;

  if (!codeMatches) {
    console.log('❌ FAIL: Generated code does not match expected result');
    console.log();
    console.log('Expected length:', EXPECTED_RESULT.length);
    console.log('Got length:', patchResult.newContent.length);
    console.log();

    // Show first difference
    for (let i = 0; i < Math.max(EXPECTED_RESULT.length, patchResult.newContent.length); i++) {
      if (EXPECTED_RESULT[i] !== patchResult.newContent[i]) {
        console.log(`First difference at position ${i}:`);
        console.log('Expected:', EXPECTED_RESULT.substring(i, i + 50));
        console.log('Got:', patchResult.newContent.substring(i, i + 50));
        break;
      }
    }

    return {
      patchApplied: true,
      codeMatches: false,
      unittestsPassed: false,
      error: 'Generated code does not match expected implementation',
    };
  }

  console.log('✓ Code matches expected implementation');
  console.log();

  // Step 4: Run the unit tests
  console.log('🧪 RUNNING UNIT TESTS:');
  console.log('-'.repeat(80));

  // Create temporary directory structure
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-limiter-test-'));
  const testDir = path.join(tempDir, 'DO_NOT_OPEN_UNIT_TEST');
  fs.mkdirSync(testDir);

  try {
    // Write the generated code
    fs.writeFileSync(path.join(tempDir, 'rate_limiter.py'), patchResult.newContent);

    // Write the unit tests
    fs.writeFileSync(path.join(testDir, 'test_rate_limiter.py'), UNIT_TESTS);

    // Run the tests
    let output = '';
    let testsPassed = false;
    let errorMessage = '';

    try {
      const result = execSync(`cd "${tempDir}" && python3 rate_limiter.py 2>&1`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 10000,
      });
      output = result;
      testsPassed = output.includes('OK') && !output.includes('FAILED');
    } catch (error: any) {
      // execSync throws on non-zero exit code, but we can still get output
      output = error.stdout || error.stderr || '';
      if (!output && error.output) {
        output = error.output.join('\n');
      }
      testsPassed = false;
      errorMessage = error.message;
    }

    console.log('Test output:');
    console.log(output);
    console.log();

    if (testsPassed) {
      console.log('✓ All unit tests passed!');
      console.log();

      return {
        patchApplied: true,
        codeMatches: true,
        unittestsPassed: true,
      };
    } else {
      console.log('❌ FAIL: Tests did not pass');
      if (errorMessage) {
        console.log('Error:', errorMessage);
      }
      console.log();

      return {
        patchApplied: true,
        codeMatches: true,
        unittestsPassed: false,
        error: errorMessage || 'Unit tests failed',
      };
    }
  } finally {
    // Clean up
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Run the test
if (require.main === module) {
  const result = runLargeIntegrationTest();

  console.log();
  console.log('=' .repeat(80));
  console.log('TEST SUMMARY:');
  console.log('=' .repeat(80));
  console.log(`Patch Applied:     ${result.patchApplied ? '✓ YES' : '✗ NO'}`);
  console.log(`Code Correct:      ${result.codeMatches ? '✓ YES' : '✗ NO'}`);
  console.log(`Unit Tests Passed: ${result.unittestsPassed ? '✓ YES' : '✗ NO'}`);

  if (result.error) {
    console.log();
    console.log('Error:', result.error);
  }

  console.log('=' .repeat(80));
  console.log();

  if (result.patchApplied && result.codeMatches && result.unittestsPassed) {
    console.log('🎉 LARGE INTEGRATION TEST PASSED!');
    console.log();
    console.log('The model successfully:');
    console.log('  1. Generated a valid unified diff');
    console.log('  2. Completed all TODO items correctly');
    console.log('  3. Produced code that passes all unit tests');
    process.exit(0);
  } else {
    console.log('❌ LARGE INTEGRATION TEST FAILED');
    console.log();
    console.log('The model needs improvement in:');
    if (!result.patchApplied) {
      console.log('  - Generating valid unified diff format');
    }
    if (!result.codeMatches) {
      console.log('  - Implementing the correct logic');
    }
    if (!result.unittestsPassed) {
      console.log('  - Ensuring code passes all tests');
    }
    process.exit(1);
  }
}

export { runLargeIntegrationTest, STARTER_CODE, README, MODEL_GENERATED_DIFF, EXPECTED_RESULT };
