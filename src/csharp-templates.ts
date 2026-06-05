/**
 * Generate Streamer.bot C# inline scripts for users to paste into
 * Actions → Add Sub-Action → C# → Execute C# Code
 */

export type CSharpTemplateId =
  | "set_global"
  | "get_global_and_log"
  | "obs_scene_router"
  | "chat_reply"
  | "custom_trigger";

export interface CSharpTemplateParams {
  variableName?: string;
  defaultValue?: string;
  persisted?: boolean;
  sceneNames?: string[];
  overlaySource?: string;
  overlayScene?: string;
  triggerName?: string;
  chatMessage?: string;
}

export function generateCSharp(
  templateId: CSharpTemplateId,
  params: CSharpTemplateParams = {}
): { filename: string; code: string; setupSteps: string[] } {
  switch (templateId) {
    case "set_global":
      return setGlobalTemplate(params);
    case "get_global_and_log":
      return getGlobalTemplate(params);
    case "obs_scene_router":
      return sceneRouterTemplate(params);
    case "chat_reply":
      return chatReplyTemplate(params);
    case "custom_trigger":
      return customTriggerTemplate(params);
    default:
      throw new Error(`Unknown template: ${templateId}`);
  }
}

function setGlobalTemplate(params: CSharpTemplateParams) {
  const name = params.variableName ?? "myVariable";
  const persisted = params.persisted !== false;
  return {
    filename: `MCP_SetGlobal_${name}.cs`,
    code: `using System;

public class CPHInline
{
    public bool Execute()
    {
        // Set from action args: %value% or hardcoded below
        string value = "${params.defaultValue ?? "hello"}";
        if (CPH.TryGetArg("value", out string argValue) && !string.IsNullOrEmpty(argValue))
            value = argValue;

        CPH.SetGlobalVar("${name}", value, ${persisted});
        CPH.LogInfo($"Set global ${name} = {value}");
        return true;
    }
}`,
    setupSteps: [
      "In Streamer.bot: Actions → pick or create an action → Sub-Actions → Add → Core → C# → Execute C# Code",
      "Paste this code, click Compile, fix any errors",
      "Trigger via do_action / execute_code_trigger, or wire a Trigger (e.g. Command, OBS)",
      `Pass arg 'value' when calling DoAction to set ${name} dynamically`,
    ],
  };
}

function getGlobalTemplate(params: CSharpTemplateParams) {
  const name = params.variableName ?? "myVariable";
  return {
    filename: `MCP_ReadGlobal_${name}.cs`,
    code: `using System;

public class CPHInline
{
    public bool Execute()
    {
        string value = CPH.GetGlobalVar<string>("${name}", true);
        CPH.SetArgument("globalValue", value ?? "");
        CPH.LogInfo($"${name} = {value}");
        return true;
    }
}`,
    setupSteps: [
      "Add as C# sub-action; after run, %globalValue% is available to later sub-actions",
      "Use Get Global Variable sub-action instead if you prefer no code",
    ],
  };
}

function sceneRouterTemplate(params: CSharpTemplateParams) {
  const scenes = params.sceneNames ?? ["ingame", "Beat Saber"];
  const overlayScene = params.overlayScene ?? "ingame";
  const overlaySource = params.overlaySource ?? "streamelementsoverlay";
  const cases = scenes
    .map(
      (s) =>
        `        if (scene.Equals("${s}", StringComparison.OrdinalIgnoreCase))\n        {\n            // TODO: CPH.RunActionByName("Scene ${s}");\n            return true;\n        }`
    )
    .join("\n");

  return {
    filename: "MCP_SceneRouter.cs",
    code: `using System;

public class CPHInline
{
    public bool Execute()
    {
        // %currentScene% is set by OBS Scene Changed trigger; fallback for manual runs:
        string scene = CPH.GetArgument<string>("currentScene", "");
        CPH.LogInfo($"OBS scene: {scene}");

        // Example: show StreamElements overlay only on ${overlayScene}
        bool showOverlay = scene.Equals("${overlayScene}", StringComparison.OrdinalIgnoreCase);
        CPH.ObsSetSourceVisibility("${overlayScene}", "${overlaySource}", showOverlay);

${cases}

        return true;
    }
}`,
    setupSteps: [
      "Requires OBS connection configured in Streamer.bot",
      "Prefer UI sub-actions for production; use this when logic is complex",
      `Adjust scene names: ${scenes.join(", ")}`,
      "Wire trigger: OBS → Scene Changed, or call from parent action",
    ],
  };
}

function chatReplyTemplate(params: CSharpTemplateParams) {
  const msg = params.chatMessage ?? "Hello %user%!";
  return {
    filename: "MCP_ChatReply.cs",
    code: `using System;

public class CPHInline
{
    public bool Execute()
    {
        string user = CPH.GetArgument<string>("user", "friend");
        string text = "${msg}".Replace("%user%", user);
        CPH.SendMessage(text, "twitch", true, false);
        return true;
    }
}`,
    setupSteps: [
      "Use when chat reply logic needs conditions C# handles best",
      "For simple messages prefer send_message MCP tool or Twitch Send Message sub-action",
    ],
  };
}

function customTriggerTemplate(params: CSharpTemplateParams) {
  const name = params.triggerName ?? "MCP_CustomEvent";
  return {
    filename: `MCP_RegisterTrigger_${name}.cs`,
    code: `using System;

public class CPHInline
{
    public bool Execute()
    {
        // Register once (e.g. on Streamer.bot start action):
        // CPH.RegisterCustomTrigger("${name}", "Triggered from MCP");

        // To fire from another action / MCP execute_code_trigger:
        CPH.TriggerCodeEvent("${name}", new Dictionary<string, object>
        {
            { "source", "mcp" },
            { "at", DateTime.UtcNow.ToString("o") }
        });
        return true;
    }
}`,
    setupSteps: [
      `Register trigger "${name}" in a startup action (see RegisterCustomTrigger in Streamer.bot C# docs)`,
      `Call execute_code_trigger with trigger_name "${name}" from MCP`,
      "Associate actions with this code trigger in Streamer.bot Triggers UI",
    ],
  };
}

export function listTemplates(): Array<{ id: CSharpTemplateId; description: string }> {
  return [
    { id: "set_global", description: "Set a persisted global variable from args or default" },
    { id: "get_global_and_log", description: "Read global into %globalValue% for downstream sub-actions" },
    { id: "obs_scene_router", description: "Branch on OBS scene + toggle overlay source visibility" },
    { id: "chat_reply", description: "Send Twitch chat message with %user% substitution" },
    { id: "custom_trigger", description: "Fire a registered custom code trigger" },
  ];
}
