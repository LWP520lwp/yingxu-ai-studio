export default {
  meta: {
    title: "Yingxu Studio",
    description:
      "An AI workspace for connected image, video, audio, and canvas projects.",
  },
  model: "Model",
  common: {
    cancel: "Cancel",
    requestCanceled: "This request was canceled",
    durationMinutes: "{{minutes}}m {{seconds}}s",
    durationSeconds: "{{seconds}}s",
    imageReadFailed: "Cannot open this image. Choose a valid image file again.",
  },
  settingsPanels: {
    model: {
      assign: "Choose a {{capability}} model in Settings.",
      noMatch:
        "No {{capability}} model is available. Check the provider settings.",
      addFirst:
        "No models yet. Add a provider in Settings and load its model list.",
      capabilities: {
        image: "image generation",
        video: "video",
        text: "text",
        audio: "audio",
      },
    },
  },
  imageReferences: {
    label: "Image {{index}}",
    separator: ", ",
    promptPrefix:
      "Reference images are labeled as follows: {{labels}}. Match each label in the prompt to its corresponding image before processing.\n\n{{prompt}}",
  },
  modelPlugin: {
    pollTimeout:
      "Model polling timed out. Check the script's task query endpoint.",
    executionFailed: "Model script failed: {{message}}",
    templates: {
      openai: "OpenAI format",
      gemini: "Gemini format",
    },
  },
  canvas: {
    create: "New canvas",
    home: "Home",
    projects: "My Canvases",
    importAsset: "Import asset",
    exportCurrent: "Export this canvas",
    undo: "Undo",
    redo: "Redo",
    shortcuts: "Keyboard shortcuts",
    nodeTypes: {
      image: "Image",
      text: "Text",
      config: "Generation config",
      video: "Video",
      audio: "Audio",
      group: "Group",
    },
    project: {
      untitled: "Untitled canvas",
      imported: "Imported canvas",
    },
    export: {
      defaultProjectName: "Yingxu Studio",
      defaultNodesName: "Canvas elements",
      item: "Element",
    },
    node: {
      node: "Node",
    },
    sidePanel: {
      canvas: "Canvas",
      assets: "Assets",
      prompts: "Prompt Library",
    },
    configNode: {
      videoReferences: "Reference videos",
      audioReferences: "Reference audio",
    },
    editors: {
      reset: "Reset",
      zoomOut: "Zoom out",
      zoomIn: "Zoom in",
      loading: "Loading",
      imageReadError: "Cannot read this image. Import it again.",
      unknown: "Unknown",
      cancel: "Cancel",
      angleTitle: "AI Multi-angle",
      angleDescription:
        "Preview the camera position, then generate a new view from the source image.",
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
        "The source already meets the 4K target. No enlargement is needed.",
      targetReached:
        "The source already meets the selected pixel target. No enlargement is needed.",
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
      cropHint: "Wheel to zoom. Middle-drag or hold Space and drag to pan.",
      cropSize: "Crop size {{size}}",
      ratio: "Ratio {{ratio}}",
      original: "Source pixels: {{width}} × {{height}}",
      confirmCrop: "Crop",
      free: "Free",
      fixed: "Fixed",
      originalMode: "Original",
      maskTitle: "Local mask edit",
      maskHint:
        "Wheel: zoom · Middle-drag or Space-drag: pan · Alt + horizontal drag: brush size · Ctrl/Cmd+Z: undo · Ctrl/Cmd+Shift+Z: redo",
      maskHistoryLimit: "You can undo the latest 100 strokes.",
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
        "Create {{count}} slices along the dividers and add image nodes to the right.",
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
      upgradeAvailable: "New version available. Click to update.",
      updateFromSource: "Update from source",
      updated: "Updated",
      uninstallTitle: "Remove this node extension?",
      uninstall: "Uninstall",
      officialDescription:
        "Add extensions to make new node types available on your canvas.",
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
        "Plugins can read this page and browser data. Review the source and code before enabling them.",
    },
    references: {
      frameRequired:
        "Connect a first-frame image. Add a last frame to set the ending.",
      frameLimit:
        "{{count}} images are connected; frame mode accepts 2. Remove extra connections or specify the first and last frames.",
    },
    composer: {
      resources: {
        text: "Text {{index}}",
      },
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
        "No valid node definition found. Check the plugin's exported value.",
      missingFields:
        "The plugin needs id and nodes fields. Add them before reinstalling.",
      downloadFailed:
        "Plugin download failed (HTTP {{status}}). Check the file address.",
      registryFailed:
        "Plugin catalog request failed (HTTP {{status}}). Refresh later.",
    },
    shortcut: {
      dragCanvas: "Drag the view to navigate",
      pan: "Move the visible canvas area",
      wheel: "Mouse wheel",
      zoom: "Zoom around the pointer position",
      zoomSlider: "Zoom slider",
      preciseZoom: "Fine-tune the view scale",
      boxSelect: "Draw a box around nodes to work on them together",
      addSelection: "Extend the current selection with the clicked node",
      selectAll: "Select every node in this canvas",
      copyPaste: "Copy selected nodes; paste nodes, clipboard text, or images",
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
  config: {
    proxy: {
      missingUrl: "Enter the local proxy address first.",
      unreachable:
        "The local proxy did not respond. Check its service and address, then test again.",
    },
    channels: {
      defaultName: "Default provider",
      newName: "New provider",
      indexedName: "Provider {{index}}",
    },
    webdav: {
      errors: {
        testFailed: "Sync connection failed. Check the WebDAV settings.",
        downloadFailed:
          "Cannot download the sync file. Check its path and read permission.",
        downloadTimeout:
          "Sync download timed out. Check the connection and retry.",
        emptyUpload: "The sync package is empty. Choose content to sync first.",
        uploadFailed: "Sync upload failed. Check write permission.",
        directoryFailed:
          "Cannot create the sync directory. Check its path and creation permission.",
        requestTimeout:
          "Sync timed out. Check the connection and service status.",
        connectionFailed:
          "Cannot connect to WebDAV. Check its address, certificate, and cross-origin settings.",
        urlRequired: "Enter the WebDAV service address.",
        authenticationFailed:
          "WebDAV sign-in failed. Check the account and password.",
        pathMissing:
          "Sync directory not found. Check the service base URL and directory path.",
        responseFailed: "{{fallback}}: {{status}}{{detail}}",
        syncFailed: "Sync did not finish. Keep the local content and retry.",
        invalidManifest:
          "The {{domain}} manifest is for another app. Choose a compatible sync file.",
      },
    },
  },
  agent: {
    composer: {
      mentions: {
        resourceMissing:
          "“{{title}}” is no longer on the canvas. Choose the reference again.",
        imageReadFailed:
          "Cannot read the image in “{{title}}”. Replace the node's media.",
      },
    },
  },
};
