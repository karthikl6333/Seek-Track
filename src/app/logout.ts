/** Robust Basic Auth logout for Chromium/Safari/Firefox. */
export function logout(): void {
  // Robust Basic Auth logout for Chromium/Safari/Firefox
  // 
  // The challenge: Browsers aggressively cache Basic Auth credentials per origin
  // and modern browsers ignore/strip embedded user:pass@ in URLs for security.
  // 
  // Solution: Use XMLHttpRequest with bogus credentials, then navigate to logout endpoint
  // 1. Send XHR with explicit wrong credentials (logout:logout) to any auth-protected endpoint
  //    → This overwrites the browser's cached Basic Auth credentials
  // 2. Navigate to /api/logout endpoint
  //    → Server returns 401 + WWW-Authenticate header
  //    → Browser realizes cached (wrong) credentials failed
  //    → Browser prompts user for new valid credentials
  // 3. After successful login → full page reload with fresh data
  
  try {
    const xhr = new XMLHttpRequest();
    const protocol = window.location.protocol;
    const host = window.location.host;
    
    // Send synchronous XHR with bogus credentials to overwrite cache
    // Using /api/logout which will return 401
    xhr.open('GET', `${protocol}//${host}/api/logout`, false, 'logout', 'logout');
    try {
      xhr.send();
    } catch {
      // Expected to fail with 401 - that's what we want
    }
    
    // Now navigate to root - browser will use the wrong cached credentials
    // and get 401, prompting for new login
    window.location.href = '/';
  } catch (error) {
    console.error('Logout error:', error);
    // Fallback: just navigate to root and hope for the best
    window.location.href = '/';
  }
}
