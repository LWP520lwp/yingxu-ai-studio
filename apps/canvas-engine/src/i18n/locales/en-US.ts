export default {
  meta: {
    title: "Yingxu Studio",
    description:
      "An AI workspace for connected image, video, audio, and canvas projects.",
  },
  theme: { toggle: "Toggle theme" },
  model: "Model",
  common: {
    cancel: "Cancel",
    close: "Close",
    untitled: "Untitled",
    save: "Save",
    edit: "Edit",
    done: "Done",
    delete: "Delete",
    copy: "Copy",
    copied: "Copied",
    copyFailed:
      "The clipboard could not be updated. Allow copying in your browser and try again.",
    details: "Details",
    addToAssets: "Add to My Assets",
    addedToAssets: "Added to My Assets",
    copyPrompt: "Copy prompt",
    promptCopied: "Prompt copied",
    created: "Created on {{date}}",
    updated: "Last changed on {{date}}",
    all: "All",
    view: "View",
    download: "Download",
    upload: "Upload",
    requestCanceled: "This request was canceled",
    durationMinutes: "{{minutes}}m {{seconds}}s",
    durationSeconds: "{{seconds}}s",
    imageReadFailed:
      "This image could not be opened. Check that the file is valid.",
  },
  settingsPanels: {
    common: {
      zoomOut: "Zoom out on canvas",
      zoomIn: "Zoom in on canvas",
      auto: "Auto",
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra high",
      max: "Maximum",
    },
    image: {
      title: "Image settings",
      quality: "Quality",
      size: "Size",
      align16: "Align to multiples of 16",
      align16Hint:
        "When you finish entering dimensions, width and height each round up to a multiple of 16.",
      resolution: "Resolution",
      aspectRatio: "Aspect ratio",
      transparent: "Transparent background",
      transparentHint:
        "Request an image with transparent areas; the selected model must support transparent output.",
      count: "Image count",
      images: "{{count}} images",
    },
    video: {
      title: "Video settings",
      quality: "Quality",
      size: "Size",
      seconds: "Seconds",
      mode: "Mode",
      modes: { frames: "First & last frame", reference: "General reference" },
      resolution: "Resolution",
      ratio: "Aspect ratio",
      duration: "Duration",
      smart: "Smart",
      output: "Output",
      generateAudio: "Generate audio",
      watermark: "Add watermark",
      adaptive: "Adaptive",
      sizes: {
        landscape: "Landscape",
        portrait: "Portrait",
        square: "Square",
        widescreen: "Widescreen",
        tall: "Tall",
        auto: "Auto",
      },
      ratios: {
        landscape: "Landscape",
        portrait: "Portrait",
        square: "Square",
        standardLandscape: "Standard landscape",
        standardPortrait: "Standard portrait",
        cinematic: "Cinematic",
        adaptive: "Adaptive",
      },
    },
    audio: {
      title: "Audio settings",
      voice: "Voice",
      format: "Format",
      speed: "Speed",
      instructions: "Voice instructions",
      instructionsPlaceholder:
        "Try a calm explanatory voice with brief pauses at key points.",
    },
    text: {
      title: "Text settings",
      reasoning: "Reasoning effort",
      count: "Generation count",
    },
    model: {
      select: "Select model",
      assign:
        "Open the provider settings and choose an available model for {{capability}}.",
      noMatch:
        "The configured providers have no model available for {{capability}}.",
      addFirst:
        "No model is available yet. Check the providers and model lists in Settings.",
      capabilities: {
        image: "image generation",
        video: "video",
        text: "text",
        audio: "audio",
      },
    },
  },
  generation: {
    retry: "Retry",
    pending: [
      "Waiting for the image result",
      "The model is processing this request",
      "The result will appear here when it arrives",
      "Still waiting for the generated output",
    ],
  },
  imageReferences: {
    label: "Image {{index}}",
    separator: ", ",
    promptPrefix:
      "Reference images are labeled as follows: {{labels}}. Match each label in the prompt to its corresponding image before processing.\n\n{{prompt}}",
  },
  modelPlugin: {
    pollTimeout:
      "The model script reached its polling deadline without a result. Check how it queries the task before retrying.",
    executionFailed:
      "The model request script stopped with this error: {{message}}",
    noImages: "The script finished without a usable image in its result.",
    variables: {
      prompt:
        "Complete prompt sent to the model, including the system instructions",
      images:
        "Decoded reference images as data URLs; may be populated for image editing or image-to-video",
      videos:
        "Reference video File objects connected to the task; append each with form.append. Empty when no video is attached.",
      audios:
        "Reference audio File objects connected to the task; append each with form.append. Empty when no audio is attached.",
      messages:
        "Messages for the current text conversation; the first entry may contain system instructions",
      params:
        "Available fields: image size, resolution, quality, count, background; video mode, seconds, size, resolution, ratio, generateAudio, watermark; audio voice, format, speed, instructions. Video mode is frames or reference; more than two images use reference mode.",
      model: "Selected model identifier without the provider prefix",
      baseUrl:
        "The provider's configured API root, with no automatic /v1 suffix",
      apiKey:
        "Provider key; raw requests must add it to an authorization header",
      systemPrompt: "System instructions from the provider settings",
      reasoningEffort:
        "Reasoning level for text models; when set to auto, the script decides whether to send it",
      http: "Convenience client with http.post, http.get, and http.url. Requests include Bearer apiKey by default; headers can override it. Relative paths resolve beneath baseUrl/v1.",
      request:
        "Low-level request({ method, url, headers, params, data, responseType }) sends headers exactly as provided. Add authentication yourself. Relative URLs join baseUrl without /v1.",
      poll: "Use poll(request, extract, {intervalMs,timeoutMs}) to check an async task; polling ends when extract returns a result",
      sleep: "Wait for a duration with sleep(ms)",
      signal: "Cancellation signal that can be forwarded to http or request",
      onDelta: "Text models can stream partial output by calling onDelta(text)",
    },
    returns: {
      image:
        "Choose the text-to-image or image-edit endpoint based on whether images is empty. Return a URL, data URL, or an array of objects containing dataUrl, url, or b64_json.",
      video:
        "Wait for the remote video task inside the script, then return { url }, { blob }, or a video URL string.",
      audio:
        "Audio output can be a Blob, a base64/data URL string, or an object with b64_json, data, or url.",
      text: "Send incremental output through onDelta(text) and return the finished text.",
    },
    templates: { openai: "OpenAI format", gemini: "Gemini format" },
    authoring: {
      intro:
        "Write a model request script for Yingxu Studio. Capability: {{capability}}. Target model: {{model}}.",
      shape:
        "Define an async function with each injected value you use in its parameter list. Expand params into readable fields such as size, quality, and count. Omit imports and Markdown fences. Make the request and return its result inside the function, then finish with return await functionName({ the same arguments }).",
      returnTitle: "Expected result shape",
      variablesTitle: "Script input fields",
      rulesTitle: "Rules",
      rules:
        "- Use an async function with explicit parameters for injected values. Expand params into documented fields such as size, quality, count, and seconds.\n- Choose request({ method, url, headers, params, data, responseType }) for full header control; http.post / http.get add Bearer apiKey unless overridden.\n- Relative request URLs join baseUrl directly; relative http paths resolve beneath baseUrl/v1.\n- For asynchronous video APIs, create the job and use poll(request, extract, { intervalMs, timeoutMs }) to retrieve its result.\n- images contains data URLs. videos and audios contain File objects that can be added with form.append; either list is empty without a connected reference.\n- Let the browser set the multipart Content-Type boundary when using FormData.\n- Return a result from the function and invoke it at the end with return await functionName({ the same arguments }). Output the complete script only.",
      examplesTitle:
        "Request script examples: check endpoints, parameters, and response fields before use",
      draftTitle:
        "Current editor content: extend this draft, or write a script if it is blank",
      anyModel: "the active model",
    },
  },
  apiErrors: {
    requestFailed: "Request failed",
    requestCanceled: "Request canceled",
    baseUrlRequired: "Add the API root address in the provider settings.",
    apiKeyRequired: "Add an API key for the selected provider.",
    authenticationFailed:
      "The service did not accept authentication. Check the provider credentials, account allowance, and model access.",
    rateLimited:
      "The service limited this request. Check the account rate and quota limits before retrying.",
    notFound:
      "The service returned 404. Check the provider base URL, endpoint path, and model identifier.",
    badGateway:
      "The service gateway returned 502 without a result. Retry once the service recovers.",
    serviceBusy:
      "The service returned 503 and cannot accept the task right now. Submit it again later.",
    httpFailed:
      "The provider returned HTTP {{status}}. Check the endpoint address and credentials.",
    htmlError:
      "The endpoint returned a web page instead of generation data: {{preview}}",
    imageTimeout:
      "No image arrived within the request deadline. Check the task status or choose a different provider.",
    audioModelRequired:
      "Choose an audio model in the provider settings to continue.",
    audioGenerationFailed: "The audio service could not finish this request.",
    scriptNoAudio:
      "The script finished, but its return value contains no readable audio.",
    geminiAudioUnsupported:
      "Audio generation is not implemented for the Gemini request format here. Use an OpenAI-format provider that supports audio.",
    invalidImageSizeFormat:
      "The size could not be parsed. Enter auto, a ratio such as 9:16, or dimensions such as 1024x1024.",
    positiveImageRatio:
      "Both numbers in the aspect ratio must be greater than zero, for example 9:16.",
    imageRatioLimit:
      "This image request allows an aspect ratio of up to 3:1. Adjust the dimensions.",
    positiveImageDimensions:
      "Width and height must both be positive whole-number pixel values, such as 1024x1024.",
    imageDimensionStep:
      "Align both width and height to multiples of 16 pixels before submitting.",
    imageEdgeLimit:
      "This image request permits a maximum edge length of 3840px. Reduce the dimensions.",
    imagePixelLimit:
      "Set width times height within the range of 655,360–8,294,400 pixels.",
    unknownImageResponse:
      "The response used an unrecognized shape (fields: {{fields}}). Confirm this model's response format.",
    noImageReturned:
      "The response has no image result. Check the service feedback, prompt review status, and supported model operations.",
    geminiRejected: "Gemini returned this rejection reason: {{reason}}",
    geminiNoImage: "No image content was found in the Gemini response.",
    maskModelUnsupported:
      "The selected model cannot use this mask editing method. Choose a channel that supports image edits.",
    noContent: "The service responded without usable content.",
    modelReadFailed:
      "The model list is unavailable. Check the provider connection.",
    videoTimeout:
      "The wait for the {{provider}} video result timed out. Check the remote task status first.",
    pluginVideoExpired:
      "This plugin video task can no longer be queried. Start a new generation.",
    scriptNoVideo:
      "The script finished without video content in its return value.",
    noPlayableVideo:
      "The video response provides no playable media address or data.",
    noVideoTaskId:
      "The creation response has no video task identifier, so progress cannot be queried.",
    videoTaskCreateFailed:
      "The video request could not be submitted. Check the provider status.",
    videoGenerationFailed: "The video service could not finish this request.",
    videoTaskQueryFailed:
      "Video progress is unavailable. Check the task again shortly.",
    videoPromptRequired:
      "Enter a video brief or connect image, video, or audio material as a reference.",
    referenceImageReadFailed:
      "The reference image could not be loaded for this request. Upload it again or replace it.",
    invalidReferenceVideo:
      "Use a publicly reachable address, an asset ID, or a locally saved video file for the video reference.",
    invalidReferenceAudio:
      "Use a publicly reachable address, an asset ID, or a locally saved audio file for the audio reference.",
    videoModelRequired:
      "Choose a video model in the provider settings to continue.",
    geminiVideoUnsupported:
      "Video generation is not implemented for the Gemini request format here. Use an OpenAI-format provider that supports video.",
    noVideoTask: "The response contains no video task details.",
    videoDownloadFailed:
      "The video file could not be downloaded. Check its address.",
    localAssetReadFailed:
      "The local asset could not be opened. Select the file again.",
  },
  prompts: {
    title: "Prompt Center",
    library: "Prompt Library",
    total: "Prompts available: {{count}}",
    category: "Category",
    tags: "Tags",
    search: "Filter by name, prompt text, or tag",
    searchTitle: "Search prompt names only",
    loadFailed: "The prompt list could not be loaded",
    sourceMissing: "The source for this prompt is unavailable",
    use: "Send to the workspace",
    empty: "No results match those filters. Try another search.",
    loading: "Reading prompts...",
    loadMore: "Keep scrolling to fetch the next batch",
    end: "All matching prompts are shown",
  },
  assets: {
    title: "Personal Library",
    description:
      "Keep reusable copy, reference images, and clips together, then retrieve them by type or keyword.",
    search: "Filter by name, text, tag, or origin",
    type: "Type",
    export: "Export assets",
    import: "Import assets",
    add: "Add asset",
    edit: "Edit asset",
    empty: "No assets found",
    manual: "Added manually",
    selectImage: "Choose an image from this device",
    updated: "Asset updated",
    saved: "Asset saved",
    textCopied: "Text copied",
    noneToExport:
      "Add content to the library before exporting an asset package.",
    imported: "Import complete: {{count}} library items",
    importFailed:
      "The asset package could not be loaded. Check that its archive format is supported by this app.",
    deleted: "Asset deleted",
    packageName: "my-assets.zip",
    kinds: { text: "Text", image: "Image", video: "Video" },
    fields: {
      title: "Title",
      titleRequired: "Name this asset before saving it.",
      titlePlaceholder: "For example: Rainy street opening shot",
      coverUrl: "Cover URL",
      coverPlaceholder:
        "Enter a cover image address or choose a picture from this device.",
      tags: "Tags",
      tagsPlaceholder: "Enter a keyword, then press Enter to add it",
      source: "Source",
      sourcePlaceholder:
        "For example: Saved manually / Canvas project / Prompt source",
      note: "Note",
      optional: "Optional",
      textContent: "Text content",
      textRequired: "Enter text content",
      textPlaceholder:
        "Store prompts, project notes, or written visual references",
      imageContent: "Image content",
    },
    selectImageFile: "Select image file",
    noImageSelected: "No image selected",
    preview: "Preview",
    noCover: "No cover",
    untitled: "Untitled asset",
    noTags: "No tags",
    untagged: "Untagged",
    unknownSource: "No origin provided",
    details: "Asset details",
    deleteTitle: "Delete asset",
    deleteConfirm: "Remove “{{name}}” from the library? This cannot be undone.",
    copyText: "Copy text",
    downloadImage: "Download image",
    downloadVideo: "Download video",
    downloadFailed:
      "This asset could not be downloaded. Check that its file is still accessible.",
  },
  notFound: {
    title: "Page not found",
    description:
      "Nothing is available at this address. The page may have moved into another part of the workspace.",
    home: "Back to home",
  },
  workbench: {
    logs: "Generation history",
    settings: "Settings",
    prompt: "Prompt",
    viewPrompts: "Browse prompts",
    viewAssets: "Browse My Assets",
    clipboard: "Clipboard",
    upload: "Upload",
    adjust: "Adjust",
    generate: "Generate",
    results: "Results",
    waiting: "Waiting {{time}}",
    model: "Model",
    generating: "Generating",
    success: "Succeeded",
    failed: "Generation failed",
    retry: "Retry",
    new: "New",
    selectAll: "Select all",
    noLogs: "Your generation history is empty",
    deleteLogs: "Remove generation entries",
    deleteLogsConfirm:
      "Remove the selected {{count}} entries from generation history?",
    successCount: "{{count}} succeeded",
    failCount: "{{count}} failed",
    itemCount: "{{count}} images",
    untitled: "Untitled",
    configFirst:
      "Choose a provider and model, then check the generation options.",
    generationFailed: "Generation failed",
    retrySuccess: "Retry succeeded",
  },
  imageWorkbench: {
    title: "Image Studio",
    promptPlaceholder:
      "Describe the subject, framing, light, visual treatment, and where the image will be used",
    references: "Reference images",
    removeReference: "Remove this image reference",
    dropReferences: "Drop images to add them to this request",
    noReferences: "No images attached yet. Drag reference images here.",
    clipboardEmpty:
      "No image data was found on the clipboard. Copy an image before pasting.",
    clipboardAdded: "{{count}} clipboard images attached as references",
    promptRequired:
      "Write a description of the image before starting generation.",
    configIncomplete:
      "Check the image provider, model, and required options before continuing.",
    invalidParams:
      "These image options are not valid for the model. Review them and try again.",
    busy: "An image request is already in progress",
    generated: "Image results are ready",
    addedReference: "This picture is now attached to the request",
    resultTitle: "Image output {{count}}",
    source: "Image Studio",
    unsupportedAsset:
      "This workspace accepts text prompts and image references. Choose a text or image asset.",
    missingResult: "This response contains no image to display.",
    empty: "Generated images will appear here",
    resultAlt: "Image output {{count}}",
    addReference: "Add as reference",
  },
  videoWorkbench: {
    title: "Video Studio",
    promptPlaceholder:
      "Describe how the camera moves, what the subject does, and the scene's light and mood",
    references: "Reference images",
    videoReferences: "Reference videos",
    audioReferences: "Reference audio",
    removeImage: "Remove this image reference",
    removeVideo: "Remove this video reference",
    removeAudio: "Remove this audio reference",
    dropReferences: "Drop files to add them to the reference list",
    noImages: "No image references yet. Add up to 9 files.",
    noVideos: "No video references yet. Add up to 3 files.",
    noAudio:
      "No audio references yet. Add up to 3 MP3/WAV files, up to 15 MB each.",
    unsupportedFiles:
      "Some files were skipped. References can be images, MP4/MOV videos, or MP3/WAV audio.",
    imageTooLarge: "A reference image exceeded 30 MB and was skipped",
    videoTooLarge: "A reference video exceeded 200 MB and was skipped",
    audioTooLarge: "A reference audio file exceeded 15 MB and was skipped",
    audioDurationInvalid:
      "Audio references must be 2–15 seconds each and 15 seconds or less in total.",
    clipboardEmpty:
      "The clipboard contains no readable image. Copy a reference image before adding it.",
    clipboardAdded: "{{count}} images attached to the video request",
    promptRequired:
      "Describe the camera, action, or setting before generating a video.",
    referenceError: "{{error}}. {{hint}}",
    invalidParams:
      "These video options are not valid for the model. Review them and try again.",
    busy: "A video request is already in progress",
    generated: "The video result is ready",
    timeout:
      "The video service did not respond in time. Retry later or check its status.",
    resultTitle: "Generated video",
    source: "Video Studio",
    empty: "Your generated video will appear here",
  },
  canvas: {
    defaultTitle: "Yingxu Studio {{count}}",
    library: "Canvas library",
    title: "Yingxu Studio",
    imported: "Canvas import complete: {{count}} projects",
    importFailed:
      "This canvas archive could not be opened. Choose a compatible archive and try again.",
    opening: "Restoring the canvas…",
    loading: "Reading your canvas library…",
    exportSelected: "Export selected",
    deleteSelected: "Delete selected",
    deleteAll: "Delete all",
    import: "Import canvas",
    create: "New canvas",
    empty: "No canvases yet",
    emptyDescription:
      "Add writing or reference material, then connect generation tasks to build your creative process.",
    collapsePanel: "Collapse panel",
    expandPanel: "Expand panel",
    home: "Home",
    docs: "Documentation",
    projects: "My Canvases",
    deleteCurrent: "Delete this canvas",
    importAsset: "Import asset",
    exportCurrent: "Export this canvas",
    undo: "Undo",
    redo: "Redo",
    openMenu: "Open canvas menu",
    renameHint: "Double-click the canvas name to change it",
    shortcuts: "Keyboard shortcuts",
    miniMapOpen: "Open minimap",
    miniMapClose: "Close minimap",
    miniMapLabel: "Canvas minimap",
    connectionsLabel: "Node relationships and generation paths",
    connectionLabel: "Connect {{from}} to {{to}}",
    miniMapHint:
      "Drag the viewport frame in the map to navigate, or use arrow keys for smaller adjustments.",
    viewControls: "Canvas view controls",
    resetView: "Reset view",
    zoom: "Zoom canvas",
    agentConnected: "Codex connected",
    agentConnecting: "Codex {{activity}}",
    agentDisconnected: "Codex disconnected",
    connecting: "Connecting",
    openAgent: "Expand the Agent conversation for this canvas",
    agentPanel: { agentMessages: "Canvas Agent conversation history" },
    nodeTypes: {
      image: "Image",
      text: "Text",
      config: "Generation config",
      video: "Video",
      audio: "Audio",
      group: "Group",
    },
    toolbar: {
      select: "Select",
      pan: "Move",
      focus: "Center focus",
      text: "Text",
      image: "Image",
      video: "Video",
      audio: "Audio",
      config: "Generation config",
      group: "Group",
      extensions: "Extension nodes",
      upload: "Upload assets",
      appearance: "Canvas appearance",
      clear: "Clear canvas",
      themeMode: "Theme",
      light: "Light",
      dark: "Dark",
      gridStyle: "Grid style",
      dots: "Dots",
      lines: "Lines",
      blank: "Blank",
      imageInfo: "Image info",
      tidy: "Tidy layout",
      audit: "Check canvas workflow",
      panHint: "Drag to pan; click again to return to selection",
      actions: "Canvas actions",
    },
    workflowAudit: {
      title: "Canvas workflow check",
      entries: "Entry nodes",
      exits: "Terminal nodes",
      isolated: "Isolated nodes",
      branches: "Branch nodes",
      clean: "Remove invalid and duplicate connections ({{count}})",
      healthy:
        "Connection check complete: no missing endpoints, duplicate edges, self-links, or directed cycles were detected.",
      issueSummary:
        "The check found {{count}} connection issues, with {{errors}} requiring attention.",
      focus: "Locate",
      untitledNode: "Untitled node",
      labels: {
        missingSource: "Missing source",
        missingTarget: "Missing target",
        selfLink: "Self-link",
        duplicateLink: "Duplicate connection",
        cycle: "Directed cycle",
      },
      details: {
        missingSource: "The connection source does not exist",
        missingSourceWithTarget:
          "The connection source does not exist; target: “{{title}}”",
        missingTarget: "The connection target does not exist",
        missingTargetWithSource:
          "The connection target does not exist; source: “{{title}}”",
        selfLink: "“{{title}}” is connected to itself",
        duplicateLink:
          "There are multiple connections from “{{from}}” to “{{to}}”",
        cycle: "“{{from}}” to “{{to}}” forms a directed cycle",
      },
    },
    project: {
      untitled: "Untitled canvas",
      imported: "Imported canvas",
      select: "Select {{name}}",
      stats: "Nodes: {{nodes}} · Links: {{connections}}",
      updated: "Updated {{date}}",
      saveName: "Save name",
      cancelRename: "Cancel rename",
      export: "Export",
      rename: "Rename",
      delete: "Delete",
      deleteTitle: "Delete canvases?",
      deleteDescription:
        "This removes {{count}} canvases together with their nodes and connections. Deleted projects cannot be restored.",
    },
    export: {
      defaultProjectName: "Yingxu Studio",
      defaultNodesName: "Canvas elements",
      item: "Element",
    },
    createMenu: {
      fromNode: "Create a task using this node as input",
      close: "Close",
      text: "Generate text",
      textDescription: "Turn your inputs into a script or written copy",
      image: "Generate image",
      video: "Generate video",
      audio: "Audio reference",
      config: "Configuration node",
      configDescription: "Set the model and generation options for this branch",
      select: "Select a node",
    },
    node: {
      node: "Node",
      untitled: "Untitled node",
      renameHint: "Double-click the node title to change its name",
      resizeTopLeft: "Resize node from top left",
      resizeTopRight: "Resize node from top right",
      resizeBottomLeft: "Resize node from bottom left",
      resizeBottomRight: "Resize node from bottom right",
      connectInput: "Connect input",
      connectOutput: "Connect output",
      group: "Group",
      nodeCount: "{{count}} nodes",
      generating: "Generating",
      failed: "Generation failed",
      generationFailed: "Generation failed",
      retry: "Retry",
      missingPlugin: "Plugin missing",
      pluginMissing: "The plugin required by this node is not enabled",
      missingPluginDescription:
        "The “{{type}}” node requires its extension. Install the extension and make sure it is enabled.",
      generateImage: "Use this text as an image prompt",
      generate: "Generate",
      editText: "Double-click the text content to start editing",
      emptyImage: "Empty image node",
      emptyVideo: "Empty video node",
      emptyAudio: "Empty audio node",
      audio: "Audio",
      batchExpanded: "Image alternatives are now visible",
      batchCollapsed: "Image alternatives are now hidden",
      textBatchExpanded: "Text alternatives are now visible",
      textBatchCollapsed: "Text alternatives are now hidden",
      createCopy: "Create copy",
      setPrimary: "Set as primary",
      setPrimaryText: "Set as primary",
    },
    videoFrames: {
      first: "Extract the opening frame",
      last: "Extract the ending frame",
      current: "Extract the frame at the playhead",
      firstTitle: "{{name}} · opening frame",
      lastTitle: "{{name}} · ending frame",
      currentTitle: "{{name}} · playhead frame",
      captured: "Image node created",
      failed:
        "This frame could not be extracted. Let the video finish loading, then capture it again.",
    },
    sidePanel: {
      title: "Canvas resource navigation",
      canvas: "Canvas",
      assets: "Assets",
      prompts: "Prompt Library",
      resize: "Drag to adjust the sidebar width",
      elements: "Canvas elements",
      select: "Select",
      searchNodes: "Search nodes",
      focusNode: "Focus node",
      preview: "Large preview",
      viewList: "Switch to list",
      viewGrid: "Browse as thumbnails",
      noNodes: "Add a node to begin",
      clearAll: "Clear all",
      selected: "{{count}} selected",
      exporting: "Packaging the selected nodes…",
      exportName: "canvas-elements-{{count}}",
      exported: "Exported {{count}} selected items",
      exportFailed:
        "The package could not be prepared. Export the selection again.",
      addingAssets: "Adding assets…",
      addedAssets: "{{count}} items added to the library",
      mediaOnly:
        "Choose an image or video file; this entry does not accept other file types.",
      addFailed:
        "These items could not be added. Check the content and try again.",
      searchAssets: "Search assets",
      add: "Add",
      noAssets: "No assets",
      inserted: "Insert into canvas",
      removeAssetTitle: "Remove this asset?",
      remove: "Remove",
      removeAsset: "Remove asset",
      assetRemoved: "Asset removed",
      searchPrompts: "Search prompts",
      noPrompts: "No prompts",
      promptCopied: "Prompt copied",
      copyFailed: "Copy failed",
      loadFailedRetry: "Content is unavailable; click to load it again",
      noMatchingPrompts: "No prompts fit these search conditions",
      sourceEmpty: "This source has no available prompts",
      viewDetails: "View details",
      filter: {
        image: "Image",
        video: "Video",
        text: "Text",
        audio: "Audio",
        config: "Configuration",
        group: "Group",
      },
    },
    assetPicker: {
      title: "Select assets",
      insert: "Insert",
      search: "Search assets",
      empty: "No assets",
    },
    imageTools: {
      copyPrompt: "Copy prompt",
      copyPromptTitle: "Copy the generation brief saved with this image",
      reversePrompt: "Reverse prompt",
      reversePromptTitle:
        "Describe the visual elements in this image and create an editable generation brief",
      replace: "Replace image",
      locked: "Lock ratio",
      free: "Free ratio",
      lockTitle: "Resize using the image's proportions",
      freeTitle: "Adjust width and height independently",
      mask: "Local edit",
      maskTitle: "Mark the area to redraw, then describe the change",
      crop: "Crop",
      cropTitle: "Save the cropped view while keeping the original image",
      split: "Split",
      splitTitle: "Separate every grid cell into its own image",
      upscale: "Upscale",
      upscaleTitle: "Enlarge the image to a new pixel size",
      superResolve: "Super resolution",
      superResolveTitle: "Use a model to add detail at a higher resolution",
      angle: "Multi-angle",
      angleTitle: "Create a new camera view from this image",
      view: "View image",
      viewTitle: "View image details",
      more: "More",
      configure: "Choose actions for the node quickbar",
      customize: "Customize toolbar",
      showLabels: "Show button labels",
      description:
        "Choose which actions appear beside image nodes. Other tools can be enabled here whenever needed.",
      preview: "Node preview",
      imageNode: "Image node",
      quickTools: "Quick tools",
    },
    nodeToolbar: {
      noPrompt: "This node has no prompt text to copy yet.",
      infoTitle: "Inspect this node's details",
      info: "Info",
      removeTitle: "Remove node",
      retryTitle: "Generate again",
      queryVideoTask: "Get task status",
      queryVideoTaskTitle:
        "Enter an existing task identifier to check video progress",
      videoTaskId: "Task ID",
      saveAsset: "Save asset",
      downloadAudio: "Download audio",
      downloadVideo: "Download video",
      downloadImage: "Download image",
      editTextTitle: "Edit text",
      editText: "Edit text",
      decreaseFont: "Decrease font size",
      increaseFont: "Increase font size",
      zoomOut: "Smaller",
      zoomIn: "Larger",
      uploadImage: "Upload image",
      replaceVideo: "Replace video",
      uploadVideo: "Upload video",
      replaceAudio: "Replace audio",
      uploadAudio: "Upload audio",
      nodeInfo: "Node information",
      name: "Name",
      type: "Type",
      size: "Size",
      position: "Position",
      status: "Status",
      imageGroup: "Image group",
      imageSize: "Image size",
      group: "Group",
      groupTitle: "Organize the selected content inside one group node",
      ungroup: "Ungroup",
      ungroupTitle: "Release the selected nodes from their group",
    },
    configNode: {
      title: "Generation config",
      image: "Image",
      text: "Text",
      video: "Video",
      audio: "Audio",
      prompt: "Prompt",
      references: "Reference images",
      videoReferences: "Reference videos",
      audioReferences: "Reference audio",
      items: "{{count}} items",
      images: "{{count}} images",
      compose: "Compose prompt",
      stop: "Stop",
      generate: "Generate",
    },
    projectPage: {
      stopTitle: "Stop generation?",
      stopDescription:
        "This ends the current wait while keeping every result already received on the canvas.",
      stop: "Stop",
      continue: "Keep generating",
      configConnection:
        "Connect a configuration node to a creative node. Configuration nodes cannot connect to each other.",
      notFound: "No canvas is available at this address.",
      exporting: "Packaging this canvas…",
      exported: "This canvas package is ready",
      clipboardText: "Clipboard text",
      clipboardImageAdded: "The clipboard image is now on the canvas",
      clipboardTextAdded: "The clipboard text is now on the canvas",
      noTextToSave: "This node contains no text to save.",
      canvasText: "Canvas text",
      noVideoToSave: "This node contains no video to save.",
      canvasVideo: "Canvas video",
      noImageToSave: "This node contains no image to save.",
      canvasImage: "Canvas image",
      emptyReverse:
        "This image node has no picture yet. Add one before extracting its prompt.",
      reverseTitle: "Reverse prompt",
      reverseConfigTitle: "Image description extraction settings",
      splitTitle: "{{name}} {{row}}-{{column}}",
      splitSuccess: "Image split complete: {{count}} picture nodes created",
      maskResult: "Local edit result",
      maskFailed: "Local edit failed",
      generationFailed: "Generation failed",
      partialFailed:
        "Some image requests did not finish. Check the individual node statuses.",
      partialTextFailed:
        "Some text requests did not finish. Check the individual node statuses.",
      allFailed:
        "No images were produced in this batch. Check the provider and request options.",
      retryPromptMissing:
        "This node has no saved generation brief. Add a prompt before submitting it again.",
      referenceMissing:
        "The reference image for this task is unavailable. Reconnect a valid image before generating.",
      emptyTextImage: "Write a generation brief in the text node first.",
      untitledCanvas: "Untitled canvas",
      superResolve: "Enhance image resolution",
      notImplemented: "This action is not available yet",
      imageDetails: "Image details",
      clearTitle: "Clear canvas?",
      clear: "Clear",
      clearDescription: "Clear every node and connection from this canvas?",
      reversePreset:
        "Write a usable image-generation prompt from the reference. Establish the subject, spatial relationships, and composition, then describe style, lighting, palette, materials, lens treatment, and mood. Return the complete prompt without a heading or explanation.",
      maskPrompt:
        "Edit the source image {{source}} only within the translucent blue region of mask {{mask}}. Preserve everything outside that region and keep the original dimensions. Remove all mask markings from the output. Requested change: {{prompt}}",
      maskNodeTitle: "Mask annotation",
      editTextPrompt:
        "Revise the text according to the request below. Preserve original information unrelated to the requested changes.\n\nText to revise:\n{{source}}\n\nRevision request:\n{{prompt}}",
    },
    reverseComposer:
      "Analyze this picture: @[node:{{imageId}}]\nFollow these instructions: @[node:{{textId}}]",
    editors: {
      reset: "Reset",
      zoomOut: "Zoom out",
      zoomIn: "Zoom in",
      loading: "Loading",
      imageReadError:
        "This image could not be read. Import it again and retry.",
      unknown: "Unknown",
      cancel: "Cancel",
      angleTitle: "AI Multi-angle",
      angleDescription:
        "Use the preview to choose the camera direction. The model then reconstructs that viewpoint using the source image.",
      horizontal: "Horizontal angle",
      pitch: "Pitch angle",
      distance: "Camera distance",
      lens: "Wide-angle lens",
      standard: "Standard",
      wide: "Wide",
      aiGenerate: "Generate with AI",
      upscaleTitle: "Upscale image",
      source: "Source",
      targetPixels: "Target pixels",
      maxReached:
        "The image already meets the target 4K dimensions, so no further enlargement is needed.",
      targetReached:
        "The current image already has enough pixels for the selected target.",
      algorithm: "Pixel resampling method",
      outputSize: "Output size",
      upscale: "Create an enlarged version",
      high: "High-quality resampling",
      highDescription: "Preserve photographic texture and small structures",
      bilinear: "Bilinear",
      bilinearDescription: "Smooth and fast",
      nearest: "Nearest neighbor",
      nearestDescription: "Best for pixel art",
      cropTitle: "Crop image",
      adjustCrop: "Adjust crop box",
      cropHint:
        "Zoom with the wheel. Pan by dragging with the middle button, or hold Space and drag with the left button.",
      cropSize: "Crop size {{size}}",
      ratio: "Ratio {{ratio}}",
      original: "Source pixels: {{width}} × {{height}}",
      confirmCrop: "Crop",
      free: "Free",
      fixed: "Fixed",
      originalMode: "Original",
      maskTitle: "Local mask edit",
      maskHint:
        "Wheel changes zoom · drag with the middle button or hold Space while dragging to pan · Alt + horizontal drag adjusts brush size · Ctrl/Cmd+Z undoes · Ctrl/Cmd+Shift+Z redoes",
      maskHistoryLimit: "Undo history keeps the latest 100 strokes.",
      brush: "Brush",
      erase: "Erase",
      undoMaskTitle: "Undo the last painted stroke (Ctrl/Cmd+Z)",
      undoMask: "Undo mask stroke",
      redoMaskTitle: "Restore the last undone stroke (Ctrl/Cmd+Shift+Z)",
      redoMask: "Redo mask stroke",
      brushSize: "Brush size",
      editInstructions: "Edit instructions",
      maskPlaceholder:
        "For example: replace the painted area with brushed metal and match the surrounding light",
      maskPromptRequired: "Describe the intended change before submitting.",
      maskRequired: "Use the brush to mark the area you want to change.",
      maskImageLoadFailed: "Could not load the image. Select it again.",
      maskExport: "Export to canvas",
      maskGenerate: "Generate now",
      splitTitle: "Split image",
      splitDescription:
        "The grid will produce {{count}} images, each placed in a new node on the right side of the canvas.",
      splitHint:
        "Wheel changes zoom · drag with the middle button or hold Space while dragging to pan · Delete removes the active split line · Ctrl/Cmd+Z undoes · Ctrl/Cmd+Shift+Z redoes",
      undoSplitTitle: "Undo the last divider change (Ctrl/Cmd+Z)",
      undoSplit: "Undo divider change",
      redoSplitTitle: "Restore the undone divider change (Ctrl/Cmd+Shift+Z)",
      redoSplit: "Restore divider change",
      rows: "Rows",
      columns: "Columns",
      horizontalLine: "Horizontal line",
      verticalLine: "Vertical line",
      deleteLine: "Delete line",
      resetLines: "Reset lines",
      pieceCount: "Pieces",
      pieces: "{{count}}",
      averageSize: "Average size",
      generateChildren: "Create child nodes",
    },
    plugins: {
      title: "Node plugins",
      installedPlugin: "Node extension {{name}} is ready",
      installed: "Extension added: {{name}}",
      installFailed: "The extension could not be installed: {{error}}",
      enabled: "Enabled",
      disabled: "Disabled",
      upgradeAvailable: "An update is available; click to apply it",
      updateFromSource: "Update from source",
      updated: "Updated",
      uninstallTitle: "Remove this node extension?",
      uninstall: "Uninstall",
      newVersion: "An update is available for this extension",
      officialDescription:
        "Choose extension nodes from the plugin catalog maintained for Yingxu.",
      refresh: "Refresh",
      loadFailed: "The extension could not be loaded: {{error}}",
      loadingOfficial: "Reading the extension catalog…",
      noOfficial: "The extension catalog is empty",
      noLocal: "No local plugins imported yet",
      install: "Install",
      urlPlaceholder:
        "Provide an extension file address, such as https://example.com/nodes.js",
      noThirdParty: "No external node extensions have been added",
      official: "Official",
      local: "Local",
      thirdParty: "Third-party",
      warning:
        "A plugin runs inside this page and may read page content or browser-local data. Check that you trust its source and understand its actions before enabling it.",
      aiConfigRequired:
        "Configure an available provider and model before starting generation.",
      interactiveTitle:
        "Node content is interactive. Switch to move mode to drag the whole node.",
      movableTitle:
        "You can drag the whole node now. Switch to interactive mode to use its controls.",
      move: "Move",
      interact: "Interact",
    },
    promptPanel: {
      video: "Describe subject movement, camera work, and scene changes",
      audio: "Describe the audio content, voice, and delivery",
      image: "Describe the subject, composition, light, and visual style",
      text: "Describe the copy, script, or other writing you need",
      editImage: "Describe the changes to make in this picture",
      editText: "Describe the revisions to make in this text",
      expandEditor: "Expand editor",
      editorTitle: "Edit prompt",
      stopGeneration: "Stop generation",
      generate: "Generate",
      stop: "Stop",
    },
    references: {
      title: "References",
      select: "Pick input material on the canvas",
      disconnect: "Remove this input link",
      empty: "No content",
      selecting: "Adding references",
      choose: "Select",
      selectingHint:
        "Pick reference material on the canvas, then press Esc to return to writing.",
      frames: {
        first: "First frame",
        last: "Last frame",
        overflow: "Extra frame",
      },
      addFrame: "Add {{frame}}",
      pendingImage: "Add an image",
      firstFrameOnly:
        "Only the first frame is connected; you can add a last frame.",
      orderHint:
        "Check the first-frame and last-frame labels. Reorder image references to change their sequence.",
      swapOrder: "Swap order",
      dragSwap: "{{frame}} · Drag to swap the first and last frames",
      frameRequired:
        "Connect a first-frame image before using this mode. Add a last-frame image if you also want to control the ending.",
      frameLimit:
        "There are {{count}} connected images, but frame mode accepts only 2. Remove extra connections or explicitly identify the first and last frame in the input.",
    },
    composer: {
      title: "Compose prompt",
      description:
        "Use @ to reference connected material. Reference numbers are refreshed from the current connections before submission.",
      placeholder:
        "Describe what to generate; type @ to choose connected writing, images, or groups",
      imagePreview: "Preview the image used in this request",
      resources: {
        image: "Image {{index}}",
        video: "Video {{index}}",
        audio: "Audio {{index}}",
        text: "Text {{index}}",
        group: "Group {{index}}",
      },
    },
    controls: {
      title: "Canvas controls",
      ratio: "Ratio",
      duplicate: "Duplicate",
      delete: "Delete",
      images: "{{count}} images",
      texts: "{{count}} options",
      generations: "{{count}} runs",
      reasoning: "Reasoning",
    },
    generation: {
      interrupted:
        "The page refresh ended this wait. Check for an existing result before submitting another task.",
      videoFrameUnsupported:
        "This video model does not accept first and last frames. Choose a built-in Muse model that supports them, or use general reference mode.",
      front: "front view",
      rotateRight: "camera turned {{angle}} degrees to the right",
      rotateLeft: "camera turned {{angle}} degrees to the left",
      level: "eye-level view",
      topDown: "camera pitched downward by {{angle}} degrees",
      lowAngle: "camera pitched upward by {{angle}} degrees",
      angleLabel:
        "AI camera setup: {{horizontal}}, {{pitch}}; distance {{distance}}; {{lens}} lens",
      anglePrompt:
        "Show the same subject from a different camera position using the reference. Keep its appearance, colors, materials, and visual style consistent. Reconstruct the scene with plausible spatial relationships instead of stretching the original image. Camera brief: {{angle}}.",
    },
    platformGeneration: {
      audioUnavailable:
        "Audio generation is not available on this platform. You can upload, play, and edit audio assets.",
      textUnavailable:
        "Text generation is not available on this platform. You can edit text and prompts, then use them as generation input.",
      imageQualityUnsupported:
        "This platform does not expose the image quality option yet. Set it to Auto before submitting.",
      imageBackgroundUnsupported:
        "Background type and transparency controls are unavailable on this platform. Set the background to Auto.",
      videoAudioUnsupported:
        "This platform cannot specify the video audio track. Use the automatic setting.",
      videoWatermarkUnsupported:
        "This platform cannot specify the watermark state. Use the automatic setting.",
      videoModeInvalid:
        "Choose Auto, General reference, or First and last frame mode.",
      videoResolutionInvalid:
        "Use Auto for video resolution, or enter a valid pixel height.",
      sizeInvalid:
        "Enter pixel dimensions (widthxheight), an aspect ratio (width:height), or Auto.",
      referenceFormatUnsupported:
        "Generation references must be PNG, JPEG, or WebP images.",
      referenceTooLarge:
        "Each generation reference must be no larger than 4 MiB.",
      referenceUploadMissingId:
        "The asset service did not return an identifier for the reference image. The generation request has not been submitted.",
      skillReviewRequired:
        "Review the shot description from the older configuration in Video Skill before continuing. Its existing wording will be preserved.",
      modelUnavailable:
        "This model channel is unavailable. Check the local account pool status in the workbench.",
      referencesUnsupported:
        "This provider accepts text but not reference images. Remove the images or choose a model with image-reference support.",
      tooManyReferences:
        "{{kind}} generation supports at most {{count}} reference images.",
      video: "video",
      image: "image",
      firstFrameRequired:
        "Connect a first-frame image to start frame-based generation. A last-frame image is optional.",
      promptRequired: "Enter a generation prompt first.",
      skillResultInvalid:
        "The video Skill returned an invalid result. Select it again.",
      promptTooLong: "Generation prompts cannot exceed 12,000 characters.",
      dimensionsInvalid:
        "Generated width and height must each be between 64 and 4,096 pixels.",
      durationInvalid:
        "Video duration must be between 2 and 20 seconds on this platform.",
      jobMismatch:
        "The returned task does not match this request. Check the task list before creating another one.",
      jobWrongProject:
        "This platform task does not belong to the current canvas. Tracking has stopped.",
      externalStatusUnknown:
        "The external task status is not confirmed. Check its progress in the workbench; the system keeps the current task and does not resubmit it automatically.",
      jobCancelled:
        "Local generation tracking has stopped. A task already submitted to the provider may continue running.",
      jobFailed: "Generation failed. Check the workbench task details.",
      resultMissing:
        "The task reports completion, but no usable material has arrived. Open the task list to inspect its result.",
      trackingLimitReached:
        "Local tracking has reached two hours. Check the remote task progress in the workbench; this does not trigger another generation.",
      imageCountInvalid: "Generate between 1 and 15 images per request.",
    },
    agentOps: {
      add_node: "Add node",
      update_node: "Update node",
      delete_node: "Delete node",
      delete_connections: "Delete connections",
      connect_nodes: "Connect",
      set_viewport: "Adjust view",
      select_nodes: "Select nodes",
      run_generation: "Run generation",
    },
    pluginErrors: {
      invalidExport:
        "This extension file provides no recognizable node definition.",
      missingFields:
        "An extension definition must include both id and nodes fields.",
      downloadFailed:
        "The extension file request was unsuccessful; HTTP status: {{status}}",
      registryFailed:
        "The plugin catalog could not be loaded. The service returned HTTP {{status}}.",
    },
    shortcut: {
      dragCanvas: "Drag the view to navigate",
      pan: "Move the visible canvas area",
      toggleTool: "Hold to use the other pointer tool temporarily",
      wheel: "Mouse wheel",
      zoom: "Zoom around the pointer position",
      zoomSlider: "Zoom slider",
      preciseZoom: "Fine-tune the view scale",
      boxSelect: "Draw a box around nodes to work on them together",
      addSelection: "Extend the current selection with the clicked node",
      selectAll: "Select every node in this canvas",
      copyPaste: "Copy selected nodes; paste nodes, clipboard text, or images",
      copyPasteNodes: "Copy nodes and paste them at the current position",
      delete: "Remove the selected nodes",
      group: "Place the selected nodes in one group",
      ungroup: "Release the selected nodes from their groups",
      escape: "Leave the current action and dismiss overlays",
      dropMedia: "Drag image, video, or audio files onto the canvas",
      upload: "Import from this device into the canvas",
      drag: "Hold and drag",
      click: "Click to act",
    },
  },
  navigation: {
    canvas: "My Canvases",
    image: "Image Studio",
    video: "Video Studio",
    prompts: "Prompt Library",
    assets: "My Assets",
    config: "Settings",
  },
  topNav: {
    openMenu: "Expand workspace navigation",
    menu: "Navigation menu",
    navigation: "Navigation",
    openAgent: "Open the Codex conversation",
    closeAgent: "Hide the Codex conversation",
    plugins: "Node plugins",
    help: "Help",
    creationSettings: "Creation settings",
    about: "About Yingxu",
    docs: "Documentation",
    switchLanguage: "Display the interface in {{language}}",
    shortcuts: "Keyboard shortcuts",
    lightTheme: "Use the light appearance",
    darkTheme: "Use the dark appearance",
  },
  home: {
    promptError: "The prompt list is unavailable. Load it again to continue.",
    description:
      "Generate, connect, and reshape <content>images, text, and graphics</content> in <canvas>Yingxu Studio</canvas>, turning one-off generations into a continuous creative process.",
    start: "Get started",
    openCanvas: "Open canvas",
    showcaseTitle: "Build a library for your next project",
    showcaseDescription:
      "Build a reusable collection of prompts, visual direction, and finished images to carry useful ideas into future projects.",
    viewPrompts: "Browse creative prompts",
  },
  version: {
    viewUpdates: "Read the version changes",
    title: "Release updates",
    currentVersion: "Current version",
    latestVersion: "Latest version",
    checking: "Checking...",
    checkUpdates: "Check for updates",
    unreleased: "Unreleased",
    latest: "Latest",
    current: "Current",
    readFailed: "Version details are currently unavailable.",
    changelogFailed: "The version change record is currently unavailable.",
    updated: "Version details are up to date",
    updateFailed: "Version details could not be refreshed. Try again later.",
    types: {
      added: "Added",
      fixed: "Fixed",
      changed: "Changed",
      optimized: "Optimized",
      docs: "Docs",
    },
  },
  config: {
    title: "Workspace configuration",
    invalidFile:
      "This settings file cannot be recognized. Choose a valid settings package.",
    description:
      "Manage model connections, creation defaults, data sync, and browser storage.",
    modalDescription:
      "Adjust model services, generation preferences, and project data storage.",
    tabs: {
      channels: "Providers",
      localProxy: "Local proxy",
      preferences: "Preferences",
      promptSources: "Prompt sources",
      localStorage: "Local storage",
    },
    proxy: {
      title: "Local proxy",
      description:
        "Forward model discovery, media generation, and WebDAV sync through a service on this machine when the browser cannot reach the target directly.",
      startHint:
        "Start a compatible local forwarding service yourself, then enter its address here. This app does not launch proxy processes.",
      address: "Proxy address",
      addressDescription:
        "Enter the proxy service's root URL, then test that it can be reached.",
      channelHint:
        "Provider and WebDAV settings still need their actual service URLs. Put the proxy URL here; switching it off sends requests directly from the browser.",
      test: "Test connection",
      available: "Connected to the local forwarding service: {{proxy}}",
      missingUrl:
        "Provide the local forwarding service address before testing it.",
      unreachable:
        "The local proxy did not respond. Confirm that its service is running and the address above is correct.",
    },
    localStorage: {
      title: "Browser data usage",
      description:
        "Review what Yingxu has stored in this browser and inspect usage by content category.",
      indexedDbUsage: "IndexedDB usage",
      siteUsage: "Total site usage",
      quota: "Available quota",
      contentEstimate: "Estimate from application data",
      siteUsageHint: "Counts IndexedDB and other data saved for this site",
      quotaHint: "The browser adjusts available space for this device",
      quotaUnavailable: "This browser does not expose a storage estimate",
      quotaProgress: "Site quota usage",
      mainDatabase: "Yingxu canvas data",
      records: "{{count}} records",
      refresh: "Refresh usage",
      readFailed:
        "Browser data usage could not be calculated. Refresh and try again.",
      stores: {
        appState: "App state",
        images: "Image files",
        imagePreviews: "Image thumbnails",
        media: "Local audio and video",
        imageLogs: "Image history",
        videoLogs: "Video history",
        agentMessages: "Codex chat content",
        promptCache: "Prompt cache",
      },
    },
    promptSources: {
      add: "Add source",
      deleteTitle: "Delete “{{name}}”?",
      deleteDescription:
        "Removing this source will not delete prompts already saved to your library.",
      refreshed: "Source “{{name}}” supplied {{count}} prompts",
      refreshFailedCached:
        "No new content was retrieved. The previous cached content remains available.",
      refreshPartial:
        "Source refresh finished: {{success}} succeeded and {{failed}} failed. Failed sources will keep their previous cache.",
      refreshAllSuccess:
        "Checked {{sources}} sources and collected {{total}} prompts",
      refreshFailed: "Update failed",
      builtIn: "Built-in",
      itemCount: "{{count}} prompts",
      failed: "Failed",
      healthy: "Healthy",
      unsynced: "Not synced",
      lastSuccess: "Most recent successful update: {{time}}",
      neverFetched: "Not fetched yet",
      view: "View content",
      refresh: "Fetch now",
      edit: "Edit source",
      schedule: "Scheduled fetch",
      interval: "Fetch interval",
      refreshAll: "Fetch all now",
      lastFetched: "Most recent fetch: {{time}}",
      neverScheduled: "No scheduled update has run",
      scheduleDescription:
        "While this page stays open, enabled sources are refreshed at the selected interval.",
      intervals: {
        disabled: "Disabled",
        minutes30: "Every 30 minutes",
        hour1: "Every hour",
        hours6: "Every 6 hours",
        hours24: "Every 24 hours",
      },
      editor: {
        addTitle: "Add prompt source",
        editTitle: "Edit prompt source",
        nameRequired:
          "A source name is required. Choose one you can recognize in the library.",
        invalidUrl: "Provide a complete, valid address for the JSON file.",
        invalidHomepage:
          "The homepage address is not valid. Provide its full URL.",
        name: "Source name",
        namePlaceholder:
          "For example: Product photography; used to label and categorize the source",
        homepage: "About this source (optional)",
        enabled: "Enable source",
        jsonFormat: "JSON format",
      },
      content: {
        loadFailed: "Prompts from this source are currently unavailable.",
        title: "{{name}} · loaded content",
        count: "{{count}} prompts",
        refresh: "Update now",
        empty: "No prompts",
        cover: "Cover",
        titleColumn: "Title",
        tags: "Tags",
        actions: "Actions",
      },
      runtime: {
        requestFailed:
          "The source request was unsuccessful; status code: {{status}}",
        urlRequired: "Provide the address of the prompt JSON file.",
        fetchFailed: "Source “{{name}}” could not be updated: {{error}}",
        noPrompts:
          "The source “{{name}}” did not provide recognizable prompt entries.",
        invalidRoot:
          "The source “{{name}}” has an unsupported structure. Its top-level JSON value must be an array.",
      },
    },
    fileSecurity:
      "Exports contain preferences and source settings, with provider API keys and WebDAV passwords removed. Importing keeps the credentials configured in this deployment.",
    import: "Import settings",
    export: "Export settings",
    imported: "Imported workspace settings are now applied",
    importedDirectConfig: "Local direct-connection parameters are now applied",
    importedChannelCreated:
      "Provider “{{name}}” was created. Other provider settings are unchanged.",
    importedChannelUpdated:
      "Provider “{{name}}” now uses the imported connection details.",
    importedChannelBaseUrlRequired:
      "The link has no provider Base URL, so the import was not applied.",
    importedChannelBaseUrlInvalid:
      "The provider Base URL in the link is unusable, so the import was not applied.",
    importFailed:
      "This settings package could not be opened. Check its contents.",
    saved: "Settings saved",
    savedContinue: "Settings are saved. Return to your task to continue.",
    channels: {
      description:
        "Select the service protocol, retrieve its model IDs, and assign their image, video, text, or audio capabilities. Use a request script when an endpoint needs a custom adapter.",
      add: "Add provider",
      unnamed: "Unnamed provider",
      numberedName: "Provider {{count}}",
      modelCount: "Models configured: {{count}}",
      missingUrl: "Set this provider's API endpoint",
      keepOne: "One provider must remain configured.",
      defaultName: "Default provider",
      newName: "New provider",
      indexedName: "Provider {{index}}",
    },
    preferences: {
      interface: "Interface",
      language: "Display language",
      languageDescription:
        "Set the language for menus, status messages, and editing controls.",
      defaultModels: "Starting models for new tasks",
      defaultImageModel: "Model for image generation",
      defaultVideoModel: "Model for video generation",
      defaultTextModel: "Model for text generation",
      defaultAudioModel: "Model for audio generation",
      generation: "Defaults for new requests",
      imageResolution: "Image resolution for new tasks",
      videoResolution: "Video resolution for new tasks",
      canvasImageCount: "Starting image count for new nodes",
      canvasImageCountDescription:
        "New image nodes use this count by default; each node can still set its own value.",
      regenerateBehavior: "Where to save a new generation result",
      regenerateBehaviorOverwrite:
        "Update the current node with the new result",
      regenerateBehaviorOverwriteDescription:
        "Write the new result and parameters into the existing node. Duplicate it first if you need to keep the previous version.",
      regenerateBehaviorNewNode:
        "Keep the current node and create a result branch",
      regenerateBehaviorNewNodeDescription:
        "Leave the current content intact and place the new result in another node for comparison or further branching.",
      autoFocusOnSelect: "Frame the view when a node is selected",
      audioVoice: "Voice for new audio tasks",
      audioFormat: "File format for new audio tasks",
      audioSpeed: "Speaking rate for new audio tasks",
      audioInstructions: "Voice direction for new audio tasks",
      audioInstructionsPlaceholder:
        "Try: Explain in a warm, natural voice and pause briefly before key points.",
      systemPrompt: "System prompt",
      systemPromptPlaceholder:
        "Try: Clarify the creative goal, then describe the scene, movement, and camera choices precisely.",
    },
    channelEditor: {
      title: "Edit provider",
      name: "Provider name",
      protocol: "Protocol",
      baseUrl: "API endpoint",
      models: "Provider models",
      modelDescription:
        "{{count}} models are selected. Set each model's purpose and add a dedicated script when an endpoint needs one.",
      selectModels: "Select models",
      scriptReady: "Script set",
      script: "Request script",
      empty:
        "Load the service's model list or enter model identifiers manually.",
      capabilities: {
        image: "Image",
        video: "Video",
        text: "Text",
        audio: "Audio",
      },
    },
    modelSelect: {
      missingConfig:
        "Add the API endpoint and API key before querying the model service.",
      fetched: "The service returned {{count}} model identifiers",
      fetchFailed:
        "The model list could not be retrieved. Check the service connection and try again.",
      title: "Manage this provider's model list",
      selected: "Models selected: {{selected}} of {{total}}",
      confirm: "Confirm",
      search: "Search models",
      modelName: "Enter a model name",
      add: "Add model",
      fetch: "Fetch model list",
      description:
        "If /models cannot supply a list, enter the exact model identifiers from the service documentation.",
      fetchedTab: "This lookup ({{count}})",
      existingTab: "Configured models ({{count}})",
      visibleSelected: "Selected here: {{selected}} of {{total}} entries",
      selectVisible: "Select this list",
      clearVisible: "Clear this list",
      fetchedEmpty:
        "Query the service for its models, or add a full model identifier in the input field.",
      existingEmpty:
        "No models are configured. Select entries from the service list or add them manually.",
    },
    scriptEditor: {
      title: "Request adapter for {{capability}}",
      description:
        "Use the input and return contract below to prepare a request script, then paste it into the editor and save. Leave the field blank to use the built-in adapter.",
      stepRule: "Read the rules",
      stepRuleHint:
        "Write an async function that receives the inputs it needs, such as prompt, images, and params. Expand options into clear fields, make the request, return its result, and invoke the function at the end.",
      stepAi: "Prepare with a coding assistant",
      stepAiCopy:
        "Copy the script brief with its input fields, expected result structure, and calling contract.",
      stepAiAsk:
        "Give the brief to your coding assistant along with the API documentation for the target service.",
      stepAiPaste:
        "Review the returned script, then put it in the editor and save.",
      stepAiIncludes:
        "The copied context contains the selected model, inputs, response shape, and script constraints. API keys are excluded.",
      stepEdit: "Paste, review, and save",
      editorTitle: "Script editor",
      editorHint:
        "Edit the request script here. You can begin with a template and adapt it to the service documentation.",
      editorEmpty: "The built-in request adapter is active",
      editorFilled: "The entered request script will be used",
      startFromTemplate: "Use a request example",
      insertTemplate: "Insert the {{name}} request example",
      restoreDefault: "Use the built-in adapter",
      returnRequirements: "Response result format",
      variables: "Available input fields",
      variablesHint:
        "Select a variable to insert its name at the editor cursor.",
      variablesHintVideo:
        "Video scripts can read connected reference video and audio files from videos and audios.",
      insert: "Click to insert",
      placeholder:
        "// Enter the request script here. Leave blank to use the built-in adapter.",
      copyBrief: "Copy script brief",
      briefCopied: "Script brief copied. Send it to your coding assistant.",
    },
    webdav: {
      title: "WebDAV sync",
      description:
        "Sync canvases, your library, generation history, and local media with WebDAV. Model API keys are excluded; network routing follows the proxy setting on this page.",
      lastSynced: "Most recent sync: {{time}}",
      neverSynced: "Not synced yet",
      url: "WebDAV URL",
      directory: "Remote directory",
      directoryDescription:
        "Separate folders are created here for each data type. Each has a {{manifest}} index and a files/ directory.",
      username: "Username",
      password: "Account password or dedicated app password",
      test: "Check the sync connection",
      syncing: "Merging sync data",
      syncNow: "Start a sync",
      missingUrl: "Set the sync service's WebDAV address to continue.",
      available: "The sync service responded successfully",
      testFailed:
        "The sync service could not be reached. Check its address and account details.",
      preparing: "Collecting content for synchronization",
      failed: "This data sync did not finish",
      completed:
        "Sync finished: {{projects}} canvases, {{assets}} assets, and {{records}} records processed; {{files}} files uploaded ({{bytes}})",
      domains: {
        canvas: "Canvases",
        assets: "My Assets",
        imageWorkbench: "Image Studio",
        videoWorkbench: "Video Studio",
      },
      stages: {
        waiting: "Waiting",
        localWaiting: "Waiting for browser data to finish loading",
        syncComplete: "Sync complete",
        remoteManifest: "Reading the WebDAV synchronization manifest",
        localData: "Collecting browser data for synchronization",
        downloadMedia: "Retrieving media files missing from this browser",
        writeMerge: "Saving merged records in browser storage",
        uploadMedia: "Sending new media files to WebDAV",
        mediaReady: "All media needed for this sync is available",
        mediaSkipped: "No media files need uploading for this sync",
        checkMissingMedia:
          "Identifying media files that are not yet available locally",
        downloadMediaFile: "Receiving a media file from WebDAV",
        checkLocalMedia: "Checking media references in browser storage",
        uploadMediaFile: "Sending media file · {{size}}",
        uploadManifest: "Saving remote manifest · {{size}}",
        complete: "Complete",
      },
      errors: {
        testFailed:
          "The sync connection check did not pass. Review the service settings.",
        downloadFailed:
          "The remote sync file could not be read. Check the WebDAV file path and permissions.",
        downloadTimeout:
          "The remote sync file took too long to arrive. Check that the WebDAV service is reachable.",
        emptyUpload:
          "The sync package has no content. An empty file will not be uploaded.",
        uploadFailed:
          "The sync file could not be written to WebDAV. Check remote write permissions.",
        directoryFailed:
          "The WebDAV storage directory could not be prepared. Check its path and directory creation permissions.",
        requestTimeout:
          "The sync request exceeded its deadline. Check the connection and WebDAV service response.",
        connectionFailed:
          "The WebDAV service could not be reached. Check its address, certificate, cross-origin policy, and network access.",
        urlRequired:
          "A WebDAV service address is required for this sync request.",
        authenticationFailed:
          "WebDAV rejected the sign-in details. Verify the account password or app-specific password.",
        pathMissing:
          "The server could not find the sync directory. Check the WebDAV base URL and directory setting.",
        responseFailed: "{{fallback}}: {{status}}{{detail}}",
        syncFailed: "The data could not be merged and synchronized.",
        invalidManifest:
          "The {{domain}} manifest has a different app identifier. Import was stopped.",
      },
    },
    protocols: {},
  },
  agent: {
    status: {
      failed: "Connection failed",
      connected: "Connected",
      connecting: "Connecting",
      disconnected: "Disconnected",
    },
    state: {
      ready: "Ready",
      connectionRequired:
        "Enter the local service URL and Connect token, then choose Connect.",
      invalidUrl:
        "Provide a complete Local URL; the current address cannot be parsed.",
      storageUnavailable:
        "This browser cannot save connection settings. You will need to enter them again after this session closes.",
      offline: "Offline",
      skillReadFailed: "This Skill file could not be opened.",
      skillParseFailed: "The content format of this Skill is not recognized.",
      requestFailed: "The local Codex service could not handle this request.",
    },
    siteTools: {
      canvasList: "Canvas list",
      generationStatus: "Check generation job progress",
      imageConfig: "Adjust image request options",
      imageGenerate: "Submit an Image Studio task",
      videoConfig: "Adjust video request options",
      videoGenerate: "Submit a Video Studio task",
      promptSearch: "Search prompts",
      assetList: "Asset list",
      assetAdd: "Add asset",
      unknownTool: "No available operation was found for {{name}}",
      canvasLoading:
        "Let the canvas finish loading before calling a node tool.",
      canvasHint:
        "Navigate to /canvas/{id} with site_navigate before operating on that canvas.",
      assetsLoading:
        "The asset catalogue has not finished loading. Try again when it is ready.",
      assetTitleRequired:
        "Provide title when adding an asset; it is used as the asset library name.",
      textContentRequired:
        "A text asset (kind=text) needs its text in content.",
      imageUrlRequired:
        "An image asset (kind=image) needs imageUrl, containing an image link or dataURL.",
      imageReadFailed:
        "This image cannot be accessed. Provide a dataURL or a link that permits cross-origin access.",
      assetKindUnsupported:
        "assets_add currently adds text assets with kind=text and image assets with kind=image.",
      imageGenerationStarted:
        "The image task has been submitted. Call generation_get_status to check its progress.",
      imageConfigApplied:
        "Image workbench parameters are updated. Start generation with a separate generation call.",
      videoGenerationStarted:
        "The video task has been submitted. Call generation_get_status to check its progress.",
      videoConfigApplied:
        "Video workbench parameters are updated. Start generation with a separate generation call.",
    },
    history: {
      workspace: "Workspace",
      defaultWorkspace: "Canvas default workspace",
      selected: "{{count}} selected",
      count: "Conversation count: {{count}}",
      empty: "No history",
      deleteCount: "Delete {{count}}",
      refresh: "Refresh",
      newThread: "New chat",
      selectThread: "Select {{name}}",
      untitled: "Unnamed chat record",
      current: "Current",
      noWorkspaceThreads:
        "This workspace has no saved Agent conversations yet.",
      connectHint:
        "Connect the local Agent to read conversations saved for this workspace.",
    },
    skills: {
      selectLocal: "Select local Skill",
      search: "Search Skills",
      loading: "Loading Skills…",
      noMatch: "No enabled skill matches this search. Try different keywords.",
      none: "The current connection has no callable skills available.",
      select: "Select Skill",
      connectHint:
        "Establish the Agent connection before choosing an installed local skill.",
    },
    skillManager: {
      codexBusy:
        "Codex is still working on this turn. Once it finishes, you can turn the complete steps into a skill.",
      noConversation:
        "There is no completed conversation result yet. Finish a task before extracting a skill.",
      noCanvas: "Open the target canvas before extracting its node process.",
      connecting:
        "The connection is being established. Continue once the Agent is ready.",
      syncFailed:
        "The Agent has not received this canvas. Check the connection and sync again.",
      noDraft:
        "This run returned no skill draft. Inspect the task result before trying again.",
      draftCreated:
        "The skill draft is ready. Review and save it on the Skills page.",
      draftFailed:
        "A skill draft could not be prepared from this content. Check the conversation record or canvas process.",
      contentMissing: "The skill body was not returned by this read.",
      readFailed: "The instructions for this skill could not be read.",
      defaultPromptMention:
        "Include the complete, exact invocation ${{name}} in the default prompt.",
      created: "The new skill is saved",
      updated: "The skill changes are saved",
      saveFailed: "The skill could not be saved. Check the local service.",
      deleteTitle: "Delete {{name}}",
      deleteDescription:
        "This removes the local skill files. The application cannot restore them after deletion.",
      delete: "Delete",
      deleted: "The skill files have been removed",
      deleteFailed:
        "The skill files could not be removed. Check access permissions.",
      statusFailed: "The enabled state of this skill could not be changed.",
      fromConversation: "Turn this chat into a skill draft",
      availableAfterRun:
        "You can prepare the skill once the current run finishes.",
      conversationDescription:
        "Extract completed actions from this conversation into steps that can be run again.",
      noCompletedContent:
        "Complete a conversation task before extracting its steps.",
      startConversation:
        "Complete a chat task to extract its steps as a skill.",
      fromCanvas: "Turn this canvas process into a skill draft",
      canvasDescription:
        "Prepare a process draft from the canvas material links, task order, and generation actions.",
      canvasUnavailable:
        "Load a canvas project before creating a skill from its contents.",
      blankCreate: "Start a blank skill",
      blankDescription:
        "Write the inputs, steps, and delivery requirements yourself",
      localSkills: "Local Skills",
      localDescription:
        "Skill files are stored locally and executed by the connected Codex service.",
      reload: "Reload",
      reloadSkill: "Reload Skills",
      createSkill: "Create Skill",
      filterBySource: "Filter by skill location",
      scopes: {
        all: "All sources",
        repo: "Project",
        user: "Personal",
        system: "System",
        admin: "Admin",
      },
      loadErrors: "Skills that could not be read: {{count}}",
      externalReadonly:
        "This skill is maintained externally. You can use or enable it here; edit its instructions at the original management location.",
      noDescription: "No description",
      enabled: "Enabled",
      disabled: "Disabled",
      selected: "Selected",
      use: "Use",
      editNamed: "Edit {{name}}",
      deleteNamed: "Delete {{name}}",
      connectToView: "Connect the Agent to load the skill list.",
      noMatch: "No skills fit the current filters",
      none: "This workspace has no local skills yet.",
      connectDescription:
        "After connecting, this view lists the installed skills discovered on the local machine.",
      tryAnotherFilter: "Change the search term or source to see other skills.",
      createOrInstall:
        "Create a skill here, or install it locally and refresh the list.",
      saveChanges: "Save changes",
      saveLocation:
        "The skill is saved in the workspace used by the local Agent.",
      basicInfo: "Basic information",
      identifier: "Skill identifier",
      identifierExtra:
        "The identifier names the skill directory and forms its $skill-name invocation.",
      identifierRequired: "Provide the skill identifier before saving.",
      identifierMax: "Use at most 64 characters for the skill identifier.",
      identifierPattern:
        "Use lowercase letters, digits, and single hyphens. Do not begin or end with a hyphen.",
      identifierPlaceholder: "For example: science-storyboard",
      displayName: "Display name",
      displayNameMax: "Keep the display name within 64 characters.",
      displayNamePlaceholder: "For example: Science video shot planner",
      whenToUse: "When to use",
      whenToUseExtra:
        "Explain the accepted input, the tasks this skill handles, and when Codex should call it.",
      whenToUseRequired: "Explain which tasks this skill should handle.",
      whenToUseMax:
        "Use at most 1,024 characters to describe when the skill applies.",
      noAngleBrackets:
        "Remove the < and > characters from the use-case description.",
      whenToUsePlaceholder:
        "For example: plan product-image shots from a product description and generate an image for each shot",
      instructions: "Instructions",
      instructionsExtra:
        "List input checks, processing actions, and delivery requirements in execution order.",
      instructionsRequired: "Add the skill's execution steps before saving.",
      instructionsPlaceholder:
        "Write the steps in order: check inputs, perform actions, verify results, and deliver output.",
      advanced: "Advanced settings",
      shortDescription: "Card summary",
      shortDescriptionExtra:
        "Summarize the skill in 25–64 characters. This text is displayed on its card.",
      shortDescriptionMin:
        "Write at least 25 characters for the skill card summary.",
      shortDescriptionMax: "Keep the skill card summary within 64 characters.",
      shortDescriptionPlaceholder:
        "Optional: summarize the skill's purpose in one sentence",
      defaultPrompt: "Default prompt",
      defaultPromptExtra:
        "Include the full invocation in the prefilled text, such as $product-grid.",
      defaultPromptMax:
        "Keep the prefilled task description within 1,024 characters.",
      defaultPromptPlaceholder:
        "Optional: task text to prefill when invoking the skill",
    },
    composer: {
      removeImage: "Remove image",
      removeSkill: "Remove Skill",
      uploadImage: "Upload image",
      stop: "Stop",
      send: "Send",
      model: "Model: {{model}}",
      selectModel: "Change the model for this turn; selected: {{model}}",
      reasoning: "Reasoning level {{effort}}",
      selectReasoning: "Adjust reasoning for this turn; selected: {{effort}}",
      permissionLabel: "Execution permissions {{mode}}",
      selectPermission:
        "Adjust Codex execution permissions; selected: {{mode}}",
      effort: {
        minimal: "Minimal",
        low: "Low",
        medium: "Medium",
        high: "High",
        xhigh: "Extra high",
        max: "Maximum",
        ultra: "Ultra",
      },
      permission: {
        request: "Ask for approval",
        requestDescription:
          "Require confirmation each time before network access or changes outside the workspace.",
        automatic: "Automatic review",
        automaticDescription:
          "Let Codex assess action risk and request confirmation when additional authorization is needed.",
        full: "Full access",
        fullShort: "Full access",
        fullDescription:
          "Allow network and local file access without a sandbox boundary.",
      },
      tools: {
        label: "Canvas write confirmation {{mode}}",
        manual: "Manual",
        manualDescription:
          "Canvas-writing tool operations run after confirmation.",
        automatic: "Automatic",
        automaticDescription:
          "Allow the Agent to run canvas-writing tools directly.",
        select: "Set how canvas writes are confirmed; selected: {{mode}}",
      },
      mentions: {
        selectSkill: "Select a Skill",
        selectResource: "Reference node content from this canvas",
        loadingSkills: "Loading Skills…",
        noSkills: "No active skills fit this search",
        noResources: "No canvas reference material matches this search.",
        previewUnavailable: "A preview is currently unavailable for this item.",
        referenceLabel: "Attached reference: {{title}} ({{kind}})",
        resourceMissing:
          "“{{title}}” is no longer on the canvas. Remove the stale reference and choose material again.",
        imageReadFailed:
          "The image for “{{title}}” could not be read. Check the node or replace its material.",
        kind: { image: "Image", video: "Video", audio: "Audio", text: "Text" },
      },
    },
    panel: {
      title: "Agent",
      setup: "Setup",
      endpoint: "Local URL",
      token: "Connect token",
      savePreferences: "Save connection settings",
      preferencesSaved: "Settings saved; Agent is not connected",
      setupDescription:
        "Enter the local Agent address. Saving these settings still requires you to connect manually.",
      transportUnavailable:
        "This canvas has no available Agent message channel. Complete the connection first.",
      emptyChat: "No Agent messages yet",
      emptyHistory: "No conversation history",
      emptyLogs: "No runtime logs",
      user: "You",
      assistant: "Agent",
      system: "System",
      tool: "Tool",
      error: "Error",
      connectionSettings: "Codex connection · {{status}}",
      connectionSettingsLabel:
        "Open Codex connection settings; status is {{status}}",
      chat: "Chat",
      history: "History",
      skills: "Skills",
      logs: "Logs",
      collapse: "Collapse chat",
      collapseLabel: "Hide the Codex conversation sidebar",
      resize: "Drag to adjust the conversation width",
      content: "Codex conversation area",
      mcpInitializing:
        "Tool services are loading. You can submit a task once they are ready.",
      initFailed:
        "The Codex conversation is not ready. Create a new one or resume an entry from history.",
      placeholder:
        "Describe your task; use / for skills and @ to reference canvas content",
    },
    chat: {
      latestMessages: "Jump to the most recent reply",
      latestCall: "Latest call",
      input: "Input",
      cached: "Cached",
      output: "Output",
    },
    logs: {
      copied: "Logs copied",
      selectedManual:
        "The log text is selected. Use your copy shortcut to save it.",
      copyFailed:
        "The clipboard could not be written. Open Raw JSON to select and copy the content manually.",
      title: "Runtime logs",
      diagnostics: "Diagnostics",
      rawJson: "Raw JSON",
      messages: "{{count}} messages",
      tool: "Tool: {{tool}}",
      noPendingTool: "No pending tool",
      all: "All {{count}}",
      errors: "Errors {{count}}",
      warnings: "Warnings {{count}}",
      info: "Info {{count}}",
      list: "Runtime diagnostic entries",
      noFiltered: "No diagnostic entries fit the current filters",
      empty: "No event logs",
      new: "{{count}} new logs",
      newLabel: "There are {{count}} new entries; click to view them",
      latest: "View latest logs",
      fullData: "Raw diagnostic entries · {{count}} items",
      copyAll: "Copy all logs",
      copyLastError: "Copy latest error",
      lastErrorCopied: "The most recent error details have been copied",
      clear: "Clear logs",
      repeated: "Occurred {{count}} times in total",
      details: "Details",
      skillLoading: "Skill loading",
      plugin: "Plugin",
      terminal: "Terminal",
      conversationStorage: "Chat record storage",
    },
    message: {
      close: "Close",
      copied: "Copied",
      copyCode: "Copy code",
      copyLink: "Copy link",
      externalWarning:
        "The external address below is about to open. Check that the site matches your task.",
      openExternal: "Open this address outside the workspace?",
      continueOpen: "Open",
      revealed: "The file location is open",
      openLocalFailed:
        "This file could not be opened on this machine. Check its path.",
      openLocal: "Open local file?",
      localDescription:
        "Continuing locates this file or folder in the local file manager.",
      externalDescription:
        "Check the destination site in the link below before opening it.",
      pathCopied: "Path copied",
      linkCopied: "Link copied",
      copyPath: "Copy path",
      showInFolder: "Open the file location",
      toolCall: "Tool call",
      awaitingConfirmation: "Confirm whether this action should run",
      reject: "Reject",
      approve: "Approve",
      networkApproval: "Request to access a network address",
      fileApproval: "File edit request",
      permissionApproval: "Request for additional execution permissions",
      commandApproval: "Request to run a local command",
      decline: "Decline",
      allowOnce: "Allow once",
      allowSession: "Allow for session",
      thinking: "Thinking",
      commandsRunning: "Commands currently running: {{count}}",
      commandRunning: "Running command",
      commandsCompleted: "Commands finished: {{count}}{{failed}}",
      commandsFailed: "; {{count}} unsuccessful",
      failed: "Failed",
      running: "In progress",
      completed: "Completed",
      command: "Command",
      slowResponse:
        "The task is still running and has not returned its final reply. Keep waiting, or use the Stop button beside the composer.",
      waitingSeconds: "Waiting time: {{seconds}} seconds",
      waitingMinutes: "Waiting time: {{minutes}} minutes {{seconds}} seconds",
      files: "Files",
      errorInfo: "Error",
      output: "Output",
      viewLarge: "View full image",
      attachmentPreview: "Preview the image sent with this message",
      noEffect: "No effect",
      canceled: "Canceled",
      recorded: "Recorded",
      stopped: "Stopped",
      finished: "Finished",
      pending: "Pending",
    },
    events: {
      analyzing: "Reviewing the task requirements…",
      reasoning: "Reasoning summary",
      plan: "Execution plan",
      commandFailed: "Command failed",
      commandCompleted: "Command completed",
      executeCommand: "Run command",
      editFiles: "Edit files",
      searchWeb: "Search the web",
      viewImage: "View image",
      imageViewed: "Image viewed",
      viewingImage: "Viewing image",
      imageGeneration: "Generate image",
      imageFailed: "This image request did not finish",
      imageCompleted: "The image result has arrived",
      generatingImage: "Generating image…",
      compactContext: "Compact context",
      contextCompacted:
        "Chat context is organized; continuing the remaining steps",
      compactingContext: "Organizing the chat context…",
      collaboration: "Collaborate",
      collaborationFailed: "A collaboration step did not finish",
      collaborationCompleted: "A collaboration step is complete",
      collaborating: "Coordinating work on the task…",
      progress: "Task progress",
      progressCount: "Task steps: {{completed}} of {{total}}",
      planning: "Arranging the task steps…",
      executingCommand: "Running command…",
      workingDirectory: "Working directory",
      exitStatus: "Exit status",
      duration: "Duration",
      seconds: "{{value}} seconds",
      filesCompleted: "The file changes are saved",
      preparingFiles: "Reviewing files to be changed…",
      fileCompleted: "{{path}} · {{action}} is complete",
      editingFile: "{{path}} · {{action}} is in progress",
      filesEdited: "Changes saved in {{count}} files: {{names}}{{more}}",
      editingFiles: "Changes in progress in {{count}} files: {{names}}{{more}}",
      andMore: " and more",
      openPage: "Open page: {{url}}",
      findInPage: "Search this page for {{pattern}}",
      content: "content",
      search: "Search: {{query}}",
      relatedInfo: "related material",
      keyword: "Keyword",
      webpage: "Web page",
      add: "Add",
      delete: "Delete",
      edit: "Edit",
      diagnostics: "Agent runtime diagnostics",
      address: "Service address {{endpoint}}",
      connection: "Service {{connection}} · currently {{status}}",
      online: "Online",
      connecting: "Connecting",
      disabled: "Disabled",
      messageTool: "Messages {{messages}} · active tool {{tool}}",
      none: "None",
      noLogs: "No event logs",
      threadCreated: "A new chat is ready",
      turnStarted: "Processing started",
      progressUpdated: "Execution progress refreshed",
      turnFailed: "Processing failed",
      turnStopped: "Processing stopped",
      turnCompleted: "This task turn has finished",
      toolCalled: "Tool called",
      toolFailed: "Tool failed",
      toolCompleted: "Tool completed",
      replyReceived: "Reply received",
      completed: "Completed",
      modelBusy: "The model cannot take a new request right now",
      modelBusyDescription:
        "This model cannot accept another task right now. Try later or choose a different model.",
      taskFailed: "Task failed",
      taskFailedDescription:
        "Codex did not finish this turn. Inspect the execution details before deciding whether to retry.",
    },
    eventExtra: {
      toolNamed: "Active tool {{name}}",
      toolOperation: "Tool operation",
      targetPage: "Target page",
      searchContent: "Search query",
      textContent: "Text content",
      operationContent: "Operations",
      imageCount: "Image count",
      tools: {
        generateImage: "Generate image",
        viewImage: "View image",
        executeCommand: "Run command",
        editFiles: "Edit files",
        searchWeb: "Search the web",
        canvasOps: "Canvas operations",
        readCanvas: "Read canvas",
        readSelection: "Read selection",
        exportSnapshot: "Export snapshot",
        createNode: "Create node",
        addAttachments: "Attach pictures to the message",
        createText: "Create text",
        createTexts: "Create text nodes",
        createConfig: "Add a task options node",
        createImageFlow: "Create image flow",
        createGenerationFlow: "Build connected generation tasks",
        generateText: "Generate text",
        generateVideo: "Generate video",
        generateAudio: "Generate audio",
        updateNode: "Update node",
        updateText: "Update text",
        moveNodes: "Move nodes",
        resizeNode: "Resize node",
        deleteNodes: "Delete nodes",
        connectNodes: "Connect nodes",
        selectNodes: "Select nodes",
        setViewport: "Adjust viewport",
        runGeneration: "Run generation",
        openPage: "Open page",
      },
    },
    eventMore: {
      toolRunning: "{{action}}…",
      openedRoute: "Opened {{route}}",
      canvasCount: "{{count}} canvases",
      promptCount: "Prompts fitting this search: {{count}}",
      assetCount: "{{count}} assets",
      assetAdded: "Added to My Assets",
      generationStatus:
        "Generation jobs ({{total}}): {{queued}} waiting · {{running}} active · {{succeeded}} complete · {{failed}} failed",
      workbenchExecuted: "The studio action has finished",
      workbenchConfigRead: "Current studio options retrieved",
      canvasRead: "Current canvas nodes and links retrieved",
      selectionRead: "Currently selected nodes retrieved",
      textNodes: "Text nodes: {{count}}",
      imageNodes: "{{count}} images",
      configNodes: "Options nodes: {{count}}",
      videoNodes: "{{count}} videos",
      audioNodes: "Audio nodes: {{count}}",
      groupNodes: "{{count}} groups",
      otherNodes: "Extension and other nodes: {{count}}",
      connections: "Link count: {{count}}",
      emptyCanvas: "This canvas has no nodes yet",
      executeTool: "Run {{tool}}",
      thinking: "Thinking...",
      operationRunning: "Working on {{operation}}…",
      organizingCanvas:
        "Nodes and connections have been read; the canvas result is being organized…",
      operationCompleted:
        "{{operation}} has ended; the Agent is processing the remaining steps…",
      attachmentPrompt:
        "Read the image attachments in this turn and use them for the current task.",
      routes: {
        home: "Home",
        canvas: "Canvas",
        canvasProject: "Selected canvas",
        image: "Image Studio",
        video: "Video Studio",
        prompts: "Prompt Center",
        assets: "My Assets",
        config: "Settings",
      },
    },
    runtime: {
      mcpStarting: "Connecting tool service {{name}}",
      mcpConnecting:
        "Establishing tool connections and reading the actions available for this task.",
      mcpReadyNamed: "Tool service {{name}} is available",
      toolsReady:
        "Tools for this run are loaded. You can send your task brief.",
      mcpFailedNamed: "Tool service {{name}} could not become ready",
      mcpCanceledNamed: "Connection to tool service {{name}} was canceled",
      toolInitFailed:
        "Tool service preparation failed. Check the connection details.",
      mcpServicesStarting: "Preparing tool services for this turn",
      toolServicesPending: "{{count}} tool services are still initializing.",
      checkingToolServices:
        "Checking the running state of connected tool services.",
      conversationInitializing: "Restoring the Codex conversation state.",
      conversationCreating:
        "Creating a conversation and connecting the canvas tools for this run.",
      someMcpFailed:
        "Some tool services are not ready. Review the connection details.",
      remainingToolsReady:
        "Available tools are ready, so this conversation can continue.",
      conversationInitFailed:
        "The Codex conversation could not be restored to a usable state.",
      conversationCreateFailed:
        "A new Codex conversation could not be created. Confirm that the local service is running and reachable.",
      mcpServicesReady: "Tool services ready: {{count}}",
      toolInitCanceled: "Tool preparation for this turn was canceled",
      mcpStatusComplete: "Tool service statuses have been checked",
      mcpListRead: "The tool-service list supplied by Codex has been read.",
      historyReadFailed:
        "Chat history could not be retrieved. Refresh and try again.",
      conversationSyncFailed:
        "This chat could not be synchronized with the local service.",
      agentOutdated:
        "The local Agent version is no longer compatible. Restart the service and reconnect.",
      restartRequired: "Restart the local Codex service to continue",
      versionMismatch:
        "The local service version is incompatible with this page",
      awaitingApproval: "Awaiting approval",
      codexRunning: "Codex is running",
      connected: "Connected",
      localAgentConnected: "The local Codex service is connected",
      processingFailed: "Processing failed",
      completed: "Completed",
      approvalGranted: "This action is allowed",
      approvalCanceled: "Authorization for this action was canceled",
      log: "Log",
      connectionLostDescription:
        "The connection to the local Agent is unavailable. Check whether its service is still running.",
      connectionFailedDescription:
        "The local service rejected the connection. Check the address and connection token.",
      connectionLost: "Connection lost",
      connectionFailed: "Connection failed",
      modelListFailed:
        "Available Codex models could not be retrieved. Check the connection.",
      imageTooLarge: "Image too large",
      imagePayloadTooLarge:
        "Images in this turn exceed 30MB in total. Remove some attachments before sending.",
      imagesSent: "Pictures submitted in this turn: {{count}}",
      canvasReferencesSent:
        "Canvas references included in this turn: {{count}}",
      someCanvasReferencesMissing:
        "Some material references in this turn have expired. Check the selected nodes again.",
      canvasReferencesMissing:
        "The referenced material is no longer on the canvas. Select the content you need again.",
      readingCanvasImages: "Preparing the referenced canvas pictures",
      canvasImageReadFailed:
        "The referenced canvas pictures could not be opened.",
      tooManyImages: "Too many images",
      imageCountLimit:
        "Uploads and canvas image references may total at most {{count}} images. Reduce the image count for this turn.",
      sending: "Sending",
      defaultModel: "Default model",
      defaultEffort: "Default effort",
      sendTask: "Send task",
      attachmentCount: "Message attachments: {{count}}",
      canvasReferenceCount: "Canvas references: {{count}}",
      attachmentsOnly: "Attachments only",
      canvasReferencesOnly: "Canvas assets",
      startConversationFailed:
        "This chat could not be started. Check the local service.",
      attachmentHistoryFailed:
        "The attachment record for this turn could not be saved.",
      sendFailed: "Send failed",
      conversationSynced: "This chat is synchronized with the service",
      taskStillRunning: "This turn is still being processed",
      stopping: "Stopping",
      stopTask: "Stop task",
      taskStopped: "Task stopped",
      stopFailed: "Failed to stop",
      imageLimit: "Image attachments may total approximately 30MB per turn.",
      imageReadFailed: "This picture could not be opened. Select it again.",
      pendingCanvasTool:
        "Confirm or cancel the pending canvas-write request before continuing.",
      awaitingConfirmation: "Resolve the action awaiting confirmation",
      toolCompleted: "{{tool}} completed",
      toolExecutionFailed: "This tool action could not be completed.",
      openCanvasFirst:
        "Call site_navigate to open the relevant canvas before using node operations.",
      canvasOperationFailed: "This canvas change could not be completed.",
      canvasToolCanceled: "The user canceled this canvas tool operation.",
      submittingApproval: "Sending the permission choice for this action",
      waitingCodexApproval:
        "Waiting for the Codex permission request to be resolved.",
      approvalFailed:
        "The permission choice could not be submitted. Check the connection.",
      enableFullAccess: "Enable full access",
      fullAccessDescription:
        "Full access allows Codex to use the network and read or write local files outside sandbox boundaries. Enable it only when appropriate for this task.",
      enableFullAccessAction: "Enable full access",
      offline: "Offline",
      addressRequired:
        "Enter the local Agent service address before connecting.",
      agentNotFound:
        "No local Agent was detected. Start its service through the desktop plugin or manually.",
      invalidAddress:
        "Check the local Agent address; it must be a complete, valid URL.",
      connecting: "Connecting",
      creatingConversation: "Preparing a new Codex chat",
      newConversation: "New conversation",
      newConversationFailed:
        "A new chat could not be prepared. Check the service status.",
      conversationResumed: "The selected chat is ready to continue",
      resumeConversationFailed:
        "The selected chat could not be resumed. Reload its history.",
      recordsDeleted: "History entries removed: {{count}}",
      deleteConversationFailed:
        "The chat record could not be removed. Try again shortly.",
      deleteConversations: "Remove the {{count}} selected chats",
      deleteConversationsDescription:
        "The selected conversations will be removed permanently. The application cannot restore these records.",
      importGeneratedImages: "Add this turn's generated pictures to the canvas",
      addedToSourceCanvas:
        "The image was added to the canvas where this run began.",
      imageGenerated: "Image generated",
      noImageAttachments:
        "This turn has no image attachments that can be added to the canvas.",
      invalidAttachmentNode:
        "The attachment image node is missing required data and cannot be imported into the canvas.",
      attachmentReadFailed:
        "The picture attached to this message could not be opened.",
      referenceImage: "Reference image",
      generatedImageReadFailed:
        "Check that the file generated by Codex still exists and is accessible; this image cannot currently be read.",
      generatedImageName: "Picture from this turn {{index}}",
    },
  },
  locale: {
    zhCN: "简体中文",
    enUS: "English",
  },
};
