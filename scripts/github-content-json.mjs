function decodeBase64Json(content, path) {
  if (typeof content !== 'string' || content.length === 0)
    throw new Error(`GitHub returned no content for ${path}`);
  return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

export async function readGithubContentJson(request, path, branch, fallback) {
  try {
    const file = await request(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
    if (file.encoding === 'base64' && file.content)
      return decodeBase64Json(file.content, path);

    // The Contents API deliberately omits inline content for files over 1 MiB.
    // Resolve the same immutable blob by SHA instead of treating the omission as
    // an empty JSON document.
    if (typeof file.sha !== 'string' || !file.sha)
      throw new Error(`GitHub returned no content or blob SHA for ${path}`);
    const blob = await request(`/git/blobs/${file.sha}`);
    if (blob.encoding !== 'base64')
      throw new Error(`GitHub returned unsupported ${blob.encoding || 'unknown'} encoding for ${path}`);
    return decodeBase64Json(blob.content, path);
  } catch (error) {
    if (String(error).includes('404')) return fallback;
    throw error;
  }
}
