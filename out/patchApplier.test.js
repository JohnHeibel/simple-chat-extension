"use strict";
/**
 * Comprehensive test suite for patch applier.
 * Run with: npm test
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTests = runTests;
const patchApplier_1 = require("./patchApplier");
const tests = [
    // Basic replacement
    {
        name: 'Simple line replacement',
        original: 'foo\nbar\nbaz\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,3 +1,3 @@
 foo
-bar
+BAR
 baz
`,
        expected: 'foo\nBAR\nbaz\n',
    },
    // Multiple replacements
    {
        name: 'Multiple changes in one hunk',
        original: 'foo\nbar\nbaz\nqux\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,4 +1,4 @@
 foo
-bar
+BAR
 baz
-qux
+QUX
`,
        expected: 'foo\nBAR\nbaz\nQUX\n',
    },
    // Multiple hunks
    {
        name: 'Multiple separate hunks',
        original: 'a\nb\nc\nd\ne\nf\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,2 +1,2 @@
 a
-b
+B
@@ -4,2 +4,2 @@
 d
-e
+E
`,
        expected: 'a\nB\nc\nd\nE\nf\n',
    },
    // Pure addition
    {
        name: 'Add lines at end of file',
        original: 'foo\nbar\n',
        diff: `--- test.txt
+++ test.txt
@@ -2,0 +3,2 @@
+baz
+qux
`,
        expected: 'foo\nbar\nbaz\nqux\n',
    },
    // Deletion
    {
        name: 'Delete lines',
        original: 'foo\nbar\nbaz\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,3 +1,2 @@
 foo
-bar
 baz
`,
        expected: 'foo\nbaz\n',
    },
    // First line replacement
    {
        name: 'Replace first line',
        original: 'foo\nbar\nbaz\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,2 +1,2 @@
-foo
+FOO
 bar
`,
        expected: 'FOO\nbar\nbaz\n',
    },
    // Last line replacement
    {
        name: 'Replace last line',
        original: 'foo\nbar\nbaz\n',
        diff: `--- test.txt
+++ test.txt
@@ -2,2 +2,2 @@
 bar
-baz
+BAZ
`,
        expected: 'foo\nbar\nBAZ\n',
    },
    // Insert at beginning
    {
        name: 'Insert at beginning',
        original: 'bar\nbaz\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,0 +1,1 @@
+foo
`,
        expected: 'bar\nbaz\nfoo\n',
    },
    // Complex interleaved changes
    {
        name: 'Interleaved additions, deletions, and replacements',
        original: 'a\nb\nc\nd\ne\nf\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,2 +1,2 @@
 a
-b
+B
@@ -3,2 +3,2 @@
 c
 d
-e
+E
@@ -6,0 +7,1 @@
+g
`,
        expected: 'a\nB\nc\nd\nE\nf\ng\n',
    },
    // Unicode punctuation handling
    {
        name: 'Match despite Unicode punctuation differences',
        original: 'import asyncio  # local import \u2013 avoids top\u2011level dep\n',
        diff: `--- test.txt
+++ test.txt
@@ -1 +1 @@
-import asyncio  # local import - avoids top-level dep
+import asyncio  # HELLO
`,
        expected: 'import asyncio  # HELLO\n',
    },
    // No trailing newline in original
    {
        name: 'File without trailing newline',
        original: 'foo\nbar',
        diff: `--- test.txt
+++ test.txt
@@ -1,2 +1,2 @@
 foo
-bar
+baz
`,
        expected: 'foo\nbaz\n',
    },
    // Empty file
    {
        name: 'Add to empty file',
        original: '',
        diff: `--- test.txt
+++ test.txt
@@ -0,0 +1,1 @@
+hello
`,
        expected: 'hello\n',
    },
    // Remove all content
    {
        name: 'Delete all content',
        original: 'foo\nbar\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,2 +0,0 @@
-foo
-bar
`,
        expected: '\n',
    },
    // Context-based matching (not relying on line numbers)
    {
        name: 'Find context even when line numbers are wrong',
        original: 'line1\nline2\nline3\nline4\nline5\n',
        diff: `--- test.txt
+++ test.txt
@@ -100,2 +100,2 @@
 line3
-line4
+LINE4
`,
        expected: 'line1\nline2\nline3\nLINE4\nline5\n',
    },
    // Multiple additions at same location
    {
        name: 'Add multiple lines at once',
        original: 'foo\nbaz\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,1 +1,3 @@
 foo
+bar1
+bar2
`,
        expected: 'foo\nbar1\nbar2\nbaz\n',
    },
    // Addition and deletion in same hunk
    {
        name: 'Replace multiple lines with different count',
        original: 'a\nb\nc\nd\n',
        diff: `--- test.txt
+++ test.txt
@@ -2,2 +2,3 @@
-b
-c
+B
+INSERTED
+C
`,
        expected: 'a\nB\nINSERTED\nC\nd\n',
    },
    // Error case: context not found
    {
        name: 'Should fail when context not found',
        original: 'foo\nbar\n',
        diff: `--- test.txt
+++ test.txt
@@ -1,2 +1,2 @@
 nonexistent
-bar
+baz
`,
        expected: '',
        shouldFail: true,
    },
    // Error case: malformed diff
    {
        name: 'Should fail on malformed diff',
        original: 'foo\nbar\n',
        diff: 'this is not a valid diff',
        expected: '',
        shouldFail: true,
    },
    // Absolute paths in diff
    {
        name: 'Handle absolute paths in diff',
        original: 'foo\nbar\n',
        diff: `--- /absolute/path/to/file.txt
+++ /absolute/path/to/file.txt
@@ -1,2 +1,2 @@
-foo
+FOO
 bar
`,
        expected: 'FOO\nbar\n',
    },
    // Paths with a/ and b/ prefixes
    {
        name: 'Handle a/ and b/ prefixes',
        original: 'foo\nbar\n',
        diff: `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-foo
+FOO
 bar
`,
        expected: 'FOO\nbar\n',
    },
];
// Test runner
function runTests() {
    let passed = 0;
    let failed = 0;
    console.log('Running patch applier tests...\n');
    for (const test of tests) {
        try {
            const result = (0, patchApplier_1.applyPatch)(test.original, test.diff);
            if (test.shouldFail) {
                if (!result.success) {
                    console.log(`✓ ${test.name} (correctly failed)`);
                    passed++;
                }
                else {
                    console.log(`✗ ${test.name}`);
                    console.log(`  Expected failure, but succeeded`);
                    console.log(`  Got: ${JSON.stringify(result.newContent)}`);
                    failed++;
                }
            }
            else {
                if (result.success && result.newContent === test.expected) {
                    console.log(`✓ ${test.name}`);
                    passed++;
                }
                else {
                    console.log(`✗ ${test.name}`);
                    if (!result.success) {
                        console.log(`  Error: ${result.error}`);
                    }
                    else {
                        console.log(`  Expected: ${JSON.stringify(test.expected)}`);
                        console.log(`  Got:      ${JSON.stringify(result.newContent)}`);
                    }
                    failed++;
                }
            }
        }
        catch (error) {
            console.log(`✗ ${test.name}`);
            console.log(`  Unexpected exception: ${error}`);
            failed++;
        }
    }
    console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);
    process.exit(failed > 0 ? 1 : 0);
}
// Run tests if this file is executed directly
if (require.main === module) {
    runTests();
}
//# sourceMappingURL=patchApplier.test.js.map