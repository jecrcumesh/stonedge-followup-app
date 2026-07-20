/* github-api.js
 * Thin wrapper around the GitHub Contents API. All calls are made directly
 * from the browser using the token the user enters at login — nothing is
 * proxied through any third-party server.
 */

const GitHubAPI = (() => {
  function authHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  // UTF-8 safe base64 encode/decode (GitHub Contents API is base64-in/out)
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  }

  function b64decode(b64) {
    const binary = atob(b64.replace(/\n/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /** Verifies the token works and can see the data repo. Throws with a
   *  human-readable message on failure. */
  async function verifyAccess(token, owner, repo) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authHeaders(token),
    });
    if (res.status === 401) throw new Error("That token was rejected — check it's valid and not expired.");
    if (res.status === 404) throw new Error(`Can't see ${owner}/${repo} — check the token has access to that repo.`);
    if (!res.ok) throw new Error(`GitHub error verifying access (${res.status}).`);
    return true;
  }

  /** Reads a JSON file from the repo. Returns { data, sha } or
   *  { data: null, sha: null } if the file doesn't exist yet. */
  async function getJSON(token, owner, repo, path, branch) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${branch ? `?ref=${branch}` : ""}`;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (res.status === 404) return { data: null, sha: null };
    if (!res.ok) throw new Error(`Couldn't read ${path} (${res.status}).`);
    const json = await res.json();
    const content = b64decode(json.content);
    return { data: JSON.parse(content), sha: json.sha };
  }

  /** Writes a JSON file back to the repo. Pass the sha you last read to
   *  avoid clobbering someone else's newer save; omit it to create a new
   *  file. Returns the new sha. */
  async function putJSON(token, owner, repo, path, branch, data, sha, message) {
    const body = {
      message: message || `Update ${path}`,
      content: b64encode(JSON.stringify(data, null, 2)),
      branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) throw new Error("CONFLICT");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Couldn't save ${path} (${res.status}).`);
    }
    const json = await res.json();
    return json.content.sha;
  }

  return { verifyAccess, getJSON, putJSON };
})();
