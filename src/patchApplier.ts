/**
 * Reliable patch application using context-based matching.
 * Inspired by OpenAI Codex's approach to patch application.
 */

export interface PatchHunk {
  oldStart: number;  // Kept for reference but not used for matching
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];  // Lines with +, -, or space prefix
}

export interface ParsedDiff {
  oldPath: string;
  newPath: string;
  hunks: PatchHunk[];
}

export interface ApplyPatchResult {
  success: boolean;
  newContent: string;
  error?: string;
}

/**
 * Parse a unified diff format into structured hunks.
 * Supports both "--- a/path" and "--- /absolute/path" formats.
 */
export function parseUnifiedDiff(diff: string): ParsedDiff | null {
  const lines = diff.split('\n');
  let oldPath = '';
  let newPath = '';
  const hunks: PatchHunk[] = [];
  let currentHunk: PatchHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse file headers
    if (line.startsWith('--- ')) {
      oldPath = line.substring(4).replace(/^a\//, '').replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = line.substring(4).replace(/^a\//, '').replace(/^b\//, '');
      continue;
    }

    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1]),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2]) : 1,
        newStart: parseInt(hunkMatch[3]),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4]) : 1,
        lines: [],
      };
      continue;
    }

    // Collect hunk lines (must have +, -, or space prefix, or be empty for blank context lines)
    if (currentHunk) {
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
        currentHunk.lines.push(line);
      } else if (line === '' && i > 0 && i < lines.length - 1) {
        // Empty line in middle of diff = blank context line
        currentHunk.lines.push(' ');
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  if (!oldPath || hunks.length === 0) {
    return null;
  }

  return { oldPath, newPath: newPath || oldPath, hunks };
}

/**
 * Search for a sequence of lines within the content, starting from a given position.
 * Returns the index where the sequence starts, or -1 if not found.
 *
 * Uses fuzzy matching to handle common punctuation differences.
 */
function seekSequence(
  contentLines: string[],
  pattern: string[],
  startIndex: number
): number {
  if (pattern.length === 0) {
    return startIndex;
  }

  // Try to find the pattern starting from startIndex
  for (let i = startIndex; i <= contentLines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (!linesMatch(contentLines[i + j], pattern[j])) {
        match = false;
        break;
      }
    }
    if (match) {
      return i;
    }
  }

  return -1;
}

/**
 * Compare two lines with fuzzy matching for common punctuation differences.
 * Normalizes en-dash, em-dash, non-breaking hyphen to ASCII dash/hyphen.
 */
function linesMatch(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  return normalizePunctuation(a) === normalizePunctuation(b);
}

/**
 * Normalize Unicode punctuation to ASCII equivalents.
 */
function normalizePunctuation(s: string): string {
  return s
    .replace(/[\u2013\u2014\u2011]/g, '-')  // en-dash, em-dash, non-breaking hyphen → hyphen
    .replace(/[\u2018\u2019]/g, "'")         // smart single quotes → apostrophe
    .replace(/[\u201C\u201D]/g, '"');        // smart double quotes → straight quotes
}

interface Replacement {
  startIndex: number;
  deleteCount: number;
  insertLines: string[];
}

/**
 * Apply a unified diff to file content.
 * Uses context-based matching instead of relying on line numbers.
 */
export function applyPatch(originalContent: string, diff: string): ApplyPatchResult {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed) {
    return {
      success: false,
      newContent: originalContent,
      error: 'Failed to parse diff format',
    };
  }

  // Split content into lines, handling the trailing newline carefully
  let lines = originalContent.split('\n');

  // Remove trailing empty element from split (represents final newline)
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  try {
    const replacements = computeReplacements(lines, parsed.hunks);
    const newLines = applyReplacements(lines, replacements);

    // Add back the trailing newline - even for empty files
    const newContent = newLines.length > 0 ? newLines.join('\n') + '\n' : '\n';

    return {
      success: true,
      newContent,
    };
  } catch (error) {
    return {
      success: false,
      newContent: originalContent,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Compute replacements from hunks using context-based search.
 * Returns array of (startIndex, deleteCount, insertLines) tuples.
 */
function computeReplacements(
  originalLines: string[],
  hunks: PatchHunk[]
): Replacement[] {
  const replacements: Replacement[] = [];
  let currentIndex = 0;

  for (const hunk of hunks) {
    // Extract old lines (context + removed) and new lines (context + added)
    const oldLines: string[] = [];
    const newLines: string[] = [];

    for (const line of hunk.lines) {
      if (line.startsWith('-')) {
        oldLines.push(line.substring(1));
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Context line appears in both
        oldLines.push(line.substring(1));
        newLines.push(line.substring(1));
      }
    }

    // Handle pure additions (no old lines to match)
    if (oldLines.length === 0) {
      // Insert at the end of file (or before final empty line if it exists)
      const insertIndex = originalLines.length;
      replacements.push({
        startIndex: insertIndex,
        deleteCount: 0,
        insertLines: newLines,
      });
      continue;
    }

    // Try to find the old lines in the file
    let pattern = oldLines;
    let foundIndex = seekSequence(originalLines, pattern, currentIndex);

    // If not found and pattern ends with empty string, retry without it
    // This handles end-of-file matching where the trailing newline isn't in our array
    if (foundIndex === -1 && pattern.length > 0 && pattern[pattern.length - 1] === '') {
      pattern = pattern.slice(0, -1);
      let adjustedNewLines = newLines;
      if (newLines.length > 0 && newLines[newLines.length - 1] === '') {
        adjustedNewLines = newLines.slice(0, -1);
      }

      foundIndex = seekSequence(originalLines, pattern, currentIndex);

      if (foundIndex !== -1) {
        replacements.push({
          startIndex: foundIndex,
          deleteCount: pattern.length,
          insertLines: adjustedNewLines,
        });
        currentIndex = foundIndex + pattern.length;
        continue;
      }
    }

    if (foundIndex === -1) {
      const contextPreview = oldLines.slice(0, 3).join('\n');
      const filePreview = originalLines.slice(0, 5).join('\n');
      throw new Error(
        `Failed to find context in file.\n` +
        `Looking for (${oldLines.length} lines):\n${contextPreview}${oldLines.length > 3 ? '\n...' : ''}\n\n` +
        `File contains (first 5 lines):\n${filePreview}${originalLines.length > 5 ? '\n...' : ''}`
      );
    }

    replacements.push({
      startIndex: foundIndex,
      deleteCount: pattern.length,
      insertLines: newLines,
    });

    currentIndex = foundIndex + pattern.length;
  }

  return replacements;
}

/**
 * Apply replacements to lines in reverse order to avoid index shifting.
 */
function applyReplacements(lines: string[], replacements: Replacement[]): string[] {
  const result = [...lines];

  // Sort by startIndex descending to apply in reverse order
  const sorted = [...replacements].sort((a, b) => b.startIndex - a.startIndex);

  for (const { startIndex, deleteCount, insertLines } of sorted) {
    // Remove old lines
    result.splice(startIndex, deleteCount);
    // Insert new lines
    result.splice(startIndex, 0, ...insertLines);
  }

  return result;
}
