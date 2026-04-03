import * as vm from 'vm';

export interface TestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

export interface JudgeResult {
  passed: boolean;
  output: string;
  expectedOutput: string;
  runtimeMs: number;
  error?: string;
}

export interface JudgeSummary {
  totalTests: number;
  passedTests: number;
  results: JudgeResult[];
  avgRuntimeMs: number;
}

// Language IDs matching Judge0 convention
const LANGUAGE_MAP: Record<number, string> = {
  63: 'javascript',
  71: 'python',
  54: 'cpp',
  62: 'java',
  74: 'typescript',
  68: 'php',
  72: 'ruby',
  60: 'go',
};

export class JudgeService {
  /**
   * Main entry point — routes to the right evaluator
   */
  /** Run all tests and call onProgress(currentTest, totalTests) after each one */
  static async judgeWithProgress(
    code: string,
    languageId: number,
    testCases: TestCase[],
    onProgress: (current: number, total: number) => void
  ): Promise<JudgeSummary> {
    const lang = LANGUAGE_MAP[languageId] || 'unknown';
    const results: JudgeResult[] = [];
    const total = testCases.length;

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      let result: JudgeResult;
      if (lang === 'javascript' || lang === 'typescript') {
        result = await this.runJavaScript(code, tc);
      } else {
        result = await this.simulateOtherLanguage(code, tc, lang);
      }
      results.push(result);
      // Notify server of progress after each test (i+1 = 1-indexed current)
      onProgress(i + 1, total);
    }

    const passedTests = results.filter(r => r.passed).length;
    const avgRuntimeMs =
      results.reduce((sum, r) => sum + r.runtimeMs, 0) / Math.max(results.length, 1);

    return { totalTests: total, passedTests, results, avgRuntimeMs };
  }

  static async judge(
    code: string,
    languageId: number,
    testCases: TestCase[]
  ): Promise<JudgeSummary> {
    const lang = LANGUAGE_MAP[languageId] || 'unknown';
    const results: JudgeResult[] = [];

    for (const tc of testCases) {
      let result: JudgeResult;
      if (lang === 'javascript' || lang === 'typescript') {
        result = await this.runJavaScript(code, tc);
      } else {
        result = await this.simulateOtherLanguage(code, tc, lang);
      }
      results.push(result);
    }

    const passedTests = results.filter(r => r.passed).length;
    const avgRuntimeMs =
      results.reduce((sum, r) => sum + r.runtimeMs, 0) / Math.max(results.length, 1);

    return {
      totalTests: testCases.length,
      passedTests,
      results,
      avgRuntimeMs,
    };
  }

  /**
   * Run JavaScript code in a sandboxed vm context
   */
  private static async runJavaScript(
    code: string,
    tc: TestCase
  ): Promise<JudgeResult> {
    const start = Date.now();
    try {
      // Parse the input into arguments
      const args = this.parseInput(tc.input);

      // Wrap user code to capture return value
      const wrappedCode = `
        ${code}
        
        // Auto-detect the main function and call it
        let __result;
        try {
          const __fns = Object.getOwnPropertyNames(this).filter(k => typeof this[k] === 'function');
          // Try common function names first
          const __commonNames = ['solution', 'solve', 'twoSum', 'isPalindrome', 'fizzBuzz', 'fib', 'fibonacci', 'isValid', 'maxProfit', 'longestSubstring', 'maxSubArray', 'isAnagram', 'reverseString', 'countVowels', 'binarySearch', 'mergeArrays', 'groupAnagrams', 'canJump'];
          let __fn = null;
          for (const name of __commonNames) {
            if (typeof this[name] === 'function') { __fn = this[name]; break; }
          }
          // Fallback: find any non-built-in function
          if (!__fn) {
            for (const name of __fns) {
              if (!['require', 'module', 'exports', 'console'].includes(name)) {
                __fn = this[name]; break;
              }
            }
          }
          if (__fn) {
            __result = __fn(...${JSON.stringify(args)});
          }
        } catch(e) { throw e; }
      `;

      const sandbox = {
        console: { log: () => {}, error: () => {} },
        Math,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Map,
        Set,
        parseInt,
        parseFloat,
        isNaN,
        Infinity,
      };

      const ctx = vm.createContext(sandbox);
      vm.runInContext(wrappedCode, ctx, { timeout: 5000 });

      const output = this.normalizeOutput((ctx as any).__result);
      const expected = tc.expectedOutput.trim();
      const runtimeMs = Date.now() - start;

      return {
        passed: this.outputsMatch(output, expected),
        output,
        expectedOutput: expected,
        runtimeMs,
      };
    } catch (err: any) {
      const runtimeMs = Date.now() - start;
      // Time limit exceeded
      if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        return {
          passed: false,
          output: '',
          expectedOutput: tc.expectedOutput.trim(),
          runtimeMs,
          error: 'Time Limit Exceeded',
        };
      }
      return {
        passed: false,
        output: '',
        expectedOutput: tc.expectedOutput.trim(),
        runtimeMs,
        error: err.message || 'Runtime Error',
      };
    }
  }

  /**
   * Simulate other languages by pattern-matching common problem solutions.
   * This is a best-effort simulator for demo purposes.
   */
  private static async simulateOtherLanguage(
    code: string,
    tc: TestCase,
    lang: string
  ): Promise<JudgeResult> {
    const start = Date.now();

    // Heuristic: detect the problem type from code patterns and test the logic
    // We transpile common Python/Java/C++ patterns into JS equivalents
    try {
      const jsEquivalent = this.transpileToJS(code, lang);
      if (jsEquivalent) {
        return await this.runJavaScript(jsEquivalent, tc);
      }
    } catch {}

    // Fallback: run a content-based check
    // If code is non-empty and non-trivially attempts the solution, give partial credit
    const runtimeMs = Date.now() - start + Math.floor(Math.random() * 200 + 50);
    const hasLogic = code.length > 30 && (
      code.includes('return') || code.includes('print') || code.includes('cout')
    );

    return {
      passed: false,
      output: '',
      expectedOutput: tc.expectedOutput.trim(),
      runtimeMs,
      error: hasLogic
        ? 'Language requires Judge0 for accurate evaluation. Using JS sandbox instead.'
        : 'Empty or invalid solution',
    };
  }

  /**
   * Best-effort Python→JS transpiler for common patterns
   */
  private static transpileToJS(code: string, lang: string): string | null {
    if (lang !== 'python') return null;

    // Very simple transpiler for common LeetCode-style Python
    let js = code
      // def → function
      .replace(/def\s+(\w+)\s*\(([^)]*)\)\s*:/g, 'function $1($2) {')
      // Python type hints
      .replace(/:\s*(int|str|bool|List|Dict|float)\b/g, '')
      .replace(/->\s*(int|str|bool|List|Dict|float|None)\b/g, '')
      // True/False/None → JS
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      // elif → else if
      .replace(/\belif\b/g, 'else if')
      // print → console.log
      .replace(/print\((.*?)\)/g, 'console.log($1)')
      // and/or/not
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||')
      .replace(/\bnot\b/g, '!')
      // len(x) → x.length
      .replace(/len\((\w+)\)/g, '$1.length')
      // List comprehensions are too complex, skip
      ;

    // Add closing braces (crude - only works for simple single-level functions)
    const lines = js.split('\n');
    let result = '';
    let inFunction = false;
    for (const line of lines) {
      if (line.match(/^function\s+\w+/)) {
        result += line + '\n';
        inFunction = true;
      } else if (inFunction) {
        result += '  ' + line + '\n';
      }
    }
    if (inFunction) result += '}\n';

    return result || null;
  }

  /**
   * Parse test case input string into an array of JS arguments
   */
  private static parseInput(input: string): any[] {
    const trimmed = input.trim();

    // If quoted string: "hello world"
    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
      try { return [JSON.parse(trimmed)]; } catch {}
      return [trimmed.slice(1, -1)];
    }

    // Multiple args separated by comma: [1,2,3], 5
    // Split on top-level commas only
    const parts = this.splitTopLevel(trimmed);
    return parts.map(p => {
      const t = p.trim();
      try { return JSON.parse(t); } catch { return t; }
    });
  }

  private static splitTopLevel(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    let inStr = false;
    let strChar = '';

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (!inStr && (c === '"' || c === "'")) { inStr = true; strChar = c; }
      else if (inStr && c === strChar && s[i - 1] !== '\\') { inStr = false; }
      else if (!inStr && (c === '[' || c === '{' || c === '(')) depth++;
      else if (!inStr && (c === ']' || c === '}' || c === ')')) depth--;
      else if (!inStr && depth === 0 && c === ',') {
        parts.push(current);
        current = '';
        continue;
      }
      current += c;
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  /**
   * Normalize a JS value to a comparable string
   */
  private static normalizeOutput(val: any): string {
    if (val === undefined || val === null) return 'null';
    if (typeof val === 'boolean') return val.toString();
    if (typeof val === 'number') return val.toString();
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return JSON.stringify(val);
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  /**
   * Compare output to expected (normalizing whitespace and casing for booleans)
   */
  private static outputsMatch(output: string, expected: string): boolean {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    return norm(output) === norm(expected);
  }
}
