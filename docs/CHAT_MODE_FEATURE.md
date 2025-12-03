# Chat Mode & Memory Feature

This document describes the Chat Mode and Memory Lane feature that enables intelligent, context-aware conversations between users and AI for project planning and implementation.

## Overview

The chat system supports two distinct modes:

1. **Chat Mode (Planning)** - Discuss and plan your project with AI
2. **Agent Mode (Building)** - AI implements code based on your requirements

Both modes share a **Memory Lane** that preserves context across the conversation, allowing AI to remember what was discussed and make informed decisions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       User Interface                         │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │  Chat Mode  │    │ Agent Mode  │   Mode Toggle          │
│  │  (Planning) │    │ (Building)  │                        │
│  └─────────────┘    └─────────────┘                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Chat Memory Service                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Memory Lane                         │  │
│  │  • Short-term memory (recent messages)               │  │
│  │  • Project requirements                              │  │
│  │  • Key decisions made                                │  │
│  │  • Implemented features                              │  │
│  │  • Conversation summary                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Model (Claude)                       │
│  • Mode-specific system prompts                             │
│  • Context-aware responses                                  │
│  • Requirement extraction                                   │
└─────────────────────────────────────────────────────────────┘
```

## Chat Modes

### Chat Mode (Planning)

In Chat Mode, AI acts as a helpful consultant:
- Asks clarifying questions about your project
- Helps think through requirements and features
- Provides suggestions based on best practices
- Does NOT generate code (yet)

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
    
    Ready to start building? Switch to Agent Mode!
```

### Agent Mode (Building)

In Agent Mode, AI is an expert developer:
- Generates production-ready code
- Follows requirements from the planning phase
- Creates files systematically
- Uses the tech stack (Next.js, TypeScript, Tailwind)

**Example:**
```
User: Start building the homepage

AI: I'll create a modern homepage for your blog.

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
