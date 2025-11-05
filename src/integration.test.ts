/**
 * Integration tests simulating real model usage.
 * Tests the complete flow: code + task → model generates diff → patch applied
 *
 * Run with: npm run test:integration
 */

import { applyPatch } from './patchApplier';

interface TestScenario {
  name: string;
  task: string;
  originalCode: string;
  modelGeneratedDiff: string;
  expectedResult: string;
}

// System prompt (from Pastebin)
const SYSTEM_PROMPT = `You are an AI coding assistant integrated into VS Code. Your purpose is to help users write, understand, and modify code.

You have access to an \`edit_file\` tool that allows you to propose changes to files. When you want to modify a file:

1. Call the \`edit_file\` tool with:
   - \`file_path\`: The full absolute path to the file (e.g., /Users/name/project/file.py)
   - \`diff\`: A unified diff format patch
   - \`description\`: A brief, clear explanation of what changes you're making

2. Your diff must use standard unified diff format:
   - Start with headers: \`--- /absolute/path/to/file\` and \`+++ /absolute/path/to/file\`
   - Include hunk headers: \`@@ -oldStart,oldCount +newStart,newCount @@\`
   - Show context lines (unchanged) with a space prefix: \` unchanged line\`
   - Show removed lines with minus prefix: \`-removed line\`
   - Show added lines with plus prefix: \`+added line\`
   - IMPORTANT: Always include 1-3 context lines before and after changes for reliable matching

3. The patch applier uses context-based matching (not line numbers), so including context lines is critical.`;

// Test scenarios simulating real model usage
const scenarios: TestScenario[] = [
  {
    name: 'Add a helper function',
    task: 'Add a helper function to validate email addresses',
    originalCode: `class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email

    def display(self):
        print(f"User: {self.name} <{self.email}>")
`,
    modelGeneratedDiff: `--- /test/user.py
+++ /test/user.py
@@ -1,7 +1,14 @@
+import re
+
 class User:
     def __init__(self, name, email):
         self.name = name
         self.email = email

+    def is_valid_email(self):
+        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
+        return re.match(pattern, self.email) is not None
+
     def display(self):
         print(f"User: {self.name} <{self.email}>")
`,
    expectedResult: `import re

class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email

    def is_valid_email(self):
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
        return re.match(pattern, self.email) is not None

    def display(self):
        print(f"User: {self.name} <{self.email}>")
`,
  },

  {
    name: 'Fix a bug (off-by-one error)',
    task: 'Fix the range to include the last element',
    originalCode: `def calculate_sum(numbers):
    total = 0
    for i in range(len(numbers) - 1):
        total += numbers[i]
    return total
`,
    modelGeneratedDiff: `--- /test/calc.py
+++ /test/calc.py
@@ -1,5 +1,5 @@
 def calculate_sum(numbers):
     total = 0
-    for i in range(len(numbers) - 1):
+    for i in range(len(numbers)):
         total += numbers[i]
     return total
`,
    expectedResult: `def calculate_sum(numbers):
    total = 0
    for i in range(len(numbers)):
        total += numbers[i]
    return total
`,
  },

  {
    name: 'Add error handling',
    task: 'Add try-except block to handle division by zero',
    originalCode: `def divide(a, b):
    return a / b

def main():
    result = divide(10, 0)
    print(result)
`,
    modelGeneratedDiff: `--- /test/math.py
+++ /test/math.py
@@ -1,6 +1,9 @@
 def divide(a, b):
-    return a / b
+    try:
+        return a / b
+    except ZeroDivisionError:
+        return None

 def main():
-    result = divide(10, 0)
-    print(result)
+    result = divide(10, 2)
+    print(f"Result: {result}")
`,
    expectedResult: `def divide(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return None

def main():
    result = divide(10, 2)
    print(f"Result: {result}")
`,
  },

  {
    name: 'Complete TODO comments',
    task: 'Implement the calculate_average function',
    originalCode: `class Statistics:
    def __init__(self, data):
        self.data = data

    def calculate_sum(self):
        return sum(self.data)

    def calculate_average(self):
        # TODO: Implement average calculation
        pass
`,
    modelGeneratedDiff: `--- /test/stats.py
+++ /test/stats.py
@@ -6,5 +6,7 @@
         return sum(self.data)

     def calculate_average(self):
-        # TODO: Implement average calculation
-        pass
+        if len(self.data) == 0:
+            return 0
+        return self.calculate_sum() / len(self.data)
`,
    expectedResult: `class Statistics:
    def __init__(self, data):
        self.data = data

    def calculate_sum(self):
        return sum(self.data)

    def calculate_average(self):
        if len(self.data) == 0:
            return 0
        return self.calculate_sum() / len(self.data)
`,
  },

  {
    name: 'Refactor code (extract method)',
    task: 'Extract validation logic into a separate method',
    originalCode: `class LoginForm:
    def submit(self, username, password):
        if not username or len(username) < 3:
            return False
        if not password or len(password) < 8:
            return False
        # Process login
        return self.authenticate(username, password)

    def authenticate(self, username, password):
        return True
`,
    modelGeneratedDiff: `--- /test/login.py
+++ /test/login.py
@@ -1,8 +1,14 @@
 class LoginForm:
+    def validate_credentials(self, username, password):
+        if not username or len(username) < 3:
+            return False
+        if not password or len(password) < 8:
+            return False
+        return True
+
     def submit(self, username, password):
-        if not username or len(username) < 3:
+        if not self.validate_credentials(username, password):
             return False
-        if not password or len(password) < 8:
-            return False
         # Process login
         return self.authenticate(username, password)
`,
    expectedResult: `class LoginForm:
    def validate_credentials(self, username, password):
        if not username or len(username) < 3:
            return False
        if not password or len(password) < 8:
            return False
        return True

    def submit(self, username, password):
        if not self.validate_credentials(username, password):
            return False
        # Process login
        return self.authenticate(username, password)

    def authenticate(self, username, password):
        return True
`,
  },

  {
    name: 'Add logging statements',
    task: 'Add debug logging to track execution',
    originalCode: `def process_data(items):
    result = []
    for item in items:
        if item > 0:
            result.append(item * 2)
    return result
`,
    modelGeneratedDiff: `--- /test/processor.py
+++ /test/processor.py
@@ -1,6 +1,9 @@
+import logging
+
 def process_data(items):
+    logging.debug(f"Processing {len(items)} items")
     result = []
     for item in items:
         if item > 0:
             result.append(item * 2)
+    logging.debug(f"Processed {len(result)} items")
     return result
`,
    expectedResult: `import logging

def process_data(items):
    logging.debug(f"Processing {len(items)} items")
    result = []
    for item in items:
        if item > 0:
            result.append(item * 2)
    logging.debug(f"Processed {len(result)} items")
    return result
`,
  },

  {
    name: 'Update function signature',
    task: 'Add optional timeout parameter with default value',
    originalCode: `def fetch_data(url):
    import requests
    response = requests.get(url)
    return response.json()
`,
    modelGeneratedDiff: `--- /test/api.py
+++ /test/api.py
@@ -1,4 +1,4 @@
-def fetch_data(url):
+def fetch_data(url, timeout=30):
     import requests
-    response = requests.get(url)
+    response = requests.get(url, timeout=timeout)
     return response.json()
`,
    expectedResult: `def fetch_data(url, timeout=30):
    import requests
    response = requests.get(url, timeout=timeout)
    return response.json()
`,
  },

  {
    name: 'Fix indentation and formatting',
    task: 'Fix inconsistent indentation',
    originalCode: `def greet(name):
  if name:
    print(f"Hello, {name}")
  else:
      print("Hello, stranger")
`,
    modelGeneratedDiff: `--- /test/greet.py
+++ /test/greet.py
@@ -1,5 +1,5 @@
 def greet(name):
-  if name:
-    print(f"Hello, {name}")
-  else:
-      print("Hello, stranger")
+    if name:
+        print(f"Hello, {name}")
+    else:
+        print("Hello, stranger")
`,
    expectedResult: `def greet(name):
    if name:
        print(f"Hello, {name}")
    else:
        print("Hello, stranger")
`,
  },
];

// Test runner
function runIntegrationTests() {
  let passed = 0;
  let failed = 0;

  console.log('Running integration tests (simulating model usage)...\n');
  console.log('System prompt context: Model understands unified diff format with context lines\n');

  for (const scenario of scenarios) {
    try {
      console.log(`Testing: ${scenario.name}`);
      console.log(`  Task: "${scenario.task}"`);

      const result = applyPatch(scenario.originalCode, scenario.modelGeneratedDiff);

      if (result.success && result.newContent === scenario.expectedResult) {
        console.log(`  ✓ PASS - Diff applied correctly\n`);
        passed++;
      } else {
        console.log(`  ✗ FAIL`);
        if (!result.success) {
          console.log(`    Error: ${result.error}`);
        } else {
          console.log(`    Expected:`);
          console.log(`    ${JSON.stringify(scenario.expectedResult)}`);
          console.log(`    Got:`);
          console.log(`    ${JSON.stringify(result.newContent)}`);
        }
        console.log('');
        failed++;
      }
    } catch (error) {
      console.log(`  ✗ FAIL - Unexpected exception: ${error}\n`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Integration Test Results: ${passed} passed, ${failed} failed out of ${scenarios.length} tests`);
  console.log(`${'='.repeat(60)}\n`);

  if (failed > 0) {
    console.log('Note: These tests simulate real model-generated diffs.');
    console.log('Failures may indicate issues with:');
    console.log('  - Context matching logic');
    console.log('  - Line number handling');
    console.log('  - Edge cases in patch format');
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runIntegrationTests();
}

export { runIntegrationTests, scenarios };
