# Chat Mode & Memory Feature

This document describes the Chat Mode and Memory Lane feature that enables intelligent, context-aware conversations between users and AI for project planning and implementation.

## Overview

The chat system supports two **strictly separated** modes:

1. **Chat Mode 💬 (Planning & Discussion)** - Discuss, plan, and explain - NO code generation
2. **Agent Mode 🤖 (Implementation)** - AI implements code based on planning phase context

Both modes share a **Memory Lane** that preserves context across the conversation, allowing Agent Mode to use everything discussed in Chat Mode.

## Key Principles

### Strict Mode Separation

- **Chat Mode is READ-ONLY**: The AI will NEVER generate code, code blocks, or file changes in Chat Mode, regardless of what the user asks
- **Agent Mode uses Chat Context**: When switching to Agent Mode, the AI has full context of all planning discussions and can implement based on that
- **No Keyword-Based Switching**: Mode is controlled ONLY by the UI toggle button, not by message content

### Why This Separation?

1. **Clear Expectations**: Users know exactly what to expect from each mode
2. **Better Planning**: Chat Mode encourages thorough planning before implementation
3. **Context Preservation**: Agent Mode has rich context from planning discussions
4. **Avoid Accidental Changes**: No code is generated unless explicitly in Agent Mode

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       User Interface                         │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │  Chat Mode  │ ←→ │ Agent Mode  │   Toggle Switch        │
│  │    💬       │    │    🤖       │                        │
│  │ (Read-Only) │    │   (Build)   │                        │
│  └─────────────┘    └─────────────┘                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Chat Memory Service                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Memory Lane                         │  │
│  │  • Short-term memory (last 15 messages)              │  │
│  │  • Long-term summary (older conversations)           │  │
│  │  • Project requirements (extracted automatically)    │  │
│  │  • Key decisions made                                │  │
│  │  • Implemented features tracking                     │  │
│  │  • Recent files created                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Model (Claude)                       │
│  • Mode-specific system prompts (strictly enforced)         │
│  • Context-aware responses                                  │
│  • Automatic requirement extraction                         │
└─────────────────────────────────────────────────────────────┘
```

## Chat Modes

### Chat Mode 💬 (Planning & Discussion)

**What it DOES:**
- Asks clarifying questions about your project
- Helps think through requirements and features
- Provides suggestions based on best practices
- Explains existing code in the project (read-only)
- Discusses architecture and design decisions
- Creates text-based plans and roadmaps

**What it NEVER does (strictly enforced):**
- Generate any code (not even examples)
- Use code blocks (```)
- Create or modify files
- Show implementations or snippets

**If user asks for code in Chat Mode:**
> "I'm currently in **Chat Mode** 💬 which is designed for planning and discussion only. I cannot write or generate code in this mode.
> 
> To implement what we've discussed, please **switch to Agent Mode** 🤖 using the toggle button at the bottom of the chat, and I'll help bring your ideas to life with working code!"

**Example Conversation:**
```
User: I want to build a personal blog

AI: Great! Let me help you plan your blog. A few questions:
    1. Do you need a contact page?
    2. What style do you prefer - modern/minimalist or classic?
    3. Any special features like comments or newsletter signup?

User: Yes to contact page, modern style, and I want newsletter signup

AI: Perfect! So we're building:
    - A modern, minimalist personal blog
    - Pages: Home, Blog posts, About, Contact
    - Features: Newsletter signup
    
    We've got a solid plan! Ready to start building? 
    Switch to **Agent Mode** 🤖 using the toggle, and I'll implement your blog step by step!

User: Create the homepage

AI: I'm in Chat Mode 💬 which is for planning only. I can't generate code here.
    To create the homepage, please switch to Agent Mode 🤖 using the toggle button!
```

### Agent Mode 🤖 (Implementation)

**What it DOES:**
- Generates production-ready code
- Uses ALL context from previous Chat Mode discussions
- Creates files systematically
- Uses the tech stack (Next.js, TypeScript, Tailwind)
- Implements features one at a time
- Builds upon existing code

**Context from Chat Mode:**
When you switch to Agent Mode, the AI has access to:
- Full conversation summary
- Extracted requirements (project type, pages, features, styling)
- Key decisions you made during planning
- Already implemented features
- Recent files created

**Example:**
```
User: (switches to Agent Mode) implement it

AI: Based on our planning discussion, I'll start implementing your 
    modern minimalist blog with:
    - Home, About, Contact pages
    - Newsletter signup feature
    
    Starting with the homepage...

📄 Creating: app/page.tsx
[Code is generated and saved]

✅ Homepage created with:
- Hero section with your intro
- Featured blog posts section
- Newsletter signup form
- Modern, responsive design

Want me to create the About page next?
```

## Memory Lane

The Memory Lane extracts and maintains context from the conversation:

### Components

1. **Short-term Memory**
   - Last 10 messages
   - Immediate context for responses

2. **Project Requirements**
   - Extracted automatically from conversation
   - Project type (blog, portfolio, e-commerce, etc.)
   - Required pages
   - Features requested
   - Styling preferences

3. **Key Decisions**
   - User confirmations and choices
   - "Let's go with..." statements
   - Preference indicators

4. **Implemented Features**
   - Tracks created files
   - Pages and components built
   - Prevents duplicate work

5. **Conversation Summary**
   - Compressed summary of earlier discussion
   - Maintains context even with long conversations

### Automatic Extraction

Requirements are extracted automatically from natural language:

| User Says | Extracted |
|-----------|-----------|
| "I want a blog" | projectType: "blog" |
| "add a contact page" | pages: ["contact"] |
| "modern and minimalist" | styling: "modern-minimalist" |
| "newsletter signup" | features: ["newsletter"] |
| "yes, looks good" | confirmed: true |

## API Usage

### Chat API with Mode

```http
POST /api/projects/{projectId}/chat
Content-Type: application/json

{
  "message": "I want to build a portfolio website",
  "conversationId": "uuid-here",
  "mode": "chat"  // or "agent"
}
```

### Response (SSE Stream)

```javascript
// Requirements update (chat mode)
data: {"type":"requirements_updated","requirements":{"projectType":"portfolio"}}

// Text content
data: {"type":"text","content":"Great! Let's plan..."}

// File creation (agent mode)
data: {"type":"file_created","file":{"path":"app/page.tsx"}}

// Completion
data: {"type":"done","conversationId":"uuid","mode":"chat","requirements":{...}}
```

### Get Conversation History

```http
GET /api/projects/{projectId}/chat/history?conversationId={id}
```

## UI Components

### Mode Toggle

```tsx
<div className="flex items-center bg-muted rounded-lg p-1">
  <Button
    variant={mode === 'chat' ? 'default' : 'ghost'}
    onClick={() => setMode('chat')}
  >
    <MessageSquare className="h-4 w-4" />
    Plan
  </Button>
  <Button
    variant={mode === 'agent' ? 'default' : 'ghost'}
    onClick={() => setMode('agent')}
  >
    <Bot className="h-4 w-4" />
    Build
  </Button>
</div>
```

### Welcome Screen (Empty State)

Different welcome messages based on mode:
- **Chat Mode**: "Tell me what you want to build" with project type suggestions
- **Agent Mode**: "Tell me what to implement" with action suggestions

### Requirements Panel

Shows extracted requirements with badges:
- Project type
- Pages to create
- Features requested
- Styling preference
- Confirmation status

## Best Practices

### For Users

1. **Start in Chat Mode** - Discuss your project first
2. **Be Specific** - Mention pages, features, and style preferences
3. **Confirm Requirements** - Say "yes" or "looks good" when satisfied
4. **Switch to Agent Mode** - When ready to build
5. **Build Incrementally** - Ask for one feature at a time

### For Developers

1. **Memory Persistence** - Stored in database with conversation
2. **Mode in Messages** - Each message stores which mode it was sent in
3. **System Prompts** - Different prompts for each mode
4. **Requirements Extraction** - Runs on every message

## Files

```
src/
├── lib/
│   ├── chat-memory.ts         # Memory lane service
│   └── terminal/
│       └── index.ts           # Exports including chat memory
├── components/
│   └── ChatConsole.tsx        # Standalone chat component (optional)
├── app/
│   ├── builder/[projectId]/
│   │   └── page.tsx           # Updated with mode toggle
│   └── api/projects/[projectId]/chat/
│       ├── route.ts           # Updated with mode support
│       └── history/
│           └── route.ts       # Conversation history API
└── db/
    └── schema.ts              # Conversations & messages tables
```

## Future Enhancements

- [ ] Visual requirements builder
- [ ] Export/import requirements as JSON
- [ ] Multi-project templates
- [ ] Collaborative planning mode
- [ ] Voice input support
- [ ] Requirements versioning
