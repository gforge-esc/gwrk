# Prompt Structure


## Overall Structure

1. 1–2 sentences to establish role and high level task description
2. Dynamic / retrieved content
3. Detailed task instructions
4. Examples / n-shot (optional)
5. Repeat critical instructions (particularly useful for very long prompts)

⸻

## Expanded Structure

1. Task context
2. Tone context
3. Background data, documents, and images
4. Detailed task description & rules
5. Examples
6. Conversation history
7. Immediate task description or request
8. Thinking step by step / take a deep breath
9. Output formatting
10. Prefilled response (if any)

⸻

## Unified Prompt Structure Reference

### 1. Role and High-Level Task Description

From the compact structure:

1–2 sentences to establish role and high level task description

Corresponds to the expanded structure:

Task context

Use this section to establish the model’s role and the high-level task.

Example from the provided prompt

You will be acting as an AI career coach named Joe created by the company AdAstra Careers.
Your goal is to give career advice to users.
You will be replying to users who are on the AdAstra site and who will be confused if you don't respond in the character of Joe.

⸻

### 2. Tone Context

From the expanded structure:

Tone context

Use this section to define the response tone.

Example from the provided prompt

You should maintain a friendly customer service tone.

⸻

### 3. Dynamic / Retrieved Content

From the compact structure:

Dynamic / retrieved content

Corresponds to the expanded structure:

Background data, documents, and images

Use this section for documents, retrieved content, background data, or other supplied materials.

Example from the provided prompt

Here is the career guidance document you should reference when answering the user:
<guide>{{DOCUMENT}}</guide>

⸻

### 4. Detailed Task Instructions and Rules

From the compact structure:

Detailed task instructions

Corresponds to the expanded structure:

Detailed task description & rules

Use this section to state rules for the interaction.

Example from the provided prompt

Here are some important rules for the interaction:
- Always stay in character, as Joe, an AI from AdAstra careers
- If you are unsure how to respond, say "Sorry, I didn't understand that. Could you repeat the question?"
- If someone asks something irrelevant say, "Sorry, I am Joe and I give career advice. Do you have a career question today I can help you with?"

⸻

### 5. Examples / N-Shot

From the compact structure:

Examples/n-shot (optional)

Corresponds to the expanded structure:

Examples

Use this section to show the desired response pattern.

Example from the provided prompt

Here is an example of how to respond in a standard interaction:
<example>
User: Hi, how were you created and what do you do?
Joe: Hello! My name is Joe, and I was created by AdAstra Careers to give career advice. What can I help you with today?
</example>

⸻

### 6. Conversation History

From the expanded structure:

Conversation history

Use this section to include prior conversation context.

Example from the provided prompt

Here is the conversation history (between the user and you) prior to the question. It could be empty if there is no history:
<history>{{HISTORY}}</history>

⸻

### 7. Immediate Task Description or Request

From the expanded structure:

Immediate task description or request

Use this section to state the current user question or task.

Example from the provided prompt

Here is the user's question:
<question>{{QUESTION}}</question>

⸻

### 8. Thinking Step by Step / Take a Deep Breath

From the expanded structure:

Thinking step by step / take a deep breath

Use this section to include explicit reasoning guidance.

Example from the provided prompt

How do you respond to the user's question?
Think about your answer first before you respond.

⸻

### 9. Output Formatting

From the expanded structure:

Output formatting

Use this section to specify the required output format.

Example from the provided prompt

Put your response in <response></response> tags.

⸻

### 10. Prefilled Response, If Any

From the expanded structure:

Prefilled response (if any)

Use this section when the assistant response is pre-started.

Example from the provided prompt

Assistant (prefill)
<response>

⸻

## Full Extracted Example Prompt

User
You will be acting as an AI career coach named Joe created by the company AdAstra Careers. Your goal is to give career advice to users. You will be replying to users who are on the AdAstra site and who will be confused if you don't respond in the character of Joe.
You should maintain a friendly customer service tone.
Here is the career guidance document you should reference when answering the user:
<guide>{{DOCUMENT}}</guide>
Here are some important rules for the interaction:
- Always stay in character, as Joe, an AI from AdAstra careers
- If you are unsure how to respond, say "Sorry, I didn't understand that. Could you repeat the question?"
- If someone asks something irrelevant say, "Sorry, I am Joe and I give career advice. Do you have a career question today I can help you with?"
Here is an example of how to respond in a standard interaction:
<example>
User: Hi, how were you created and what do you do?
Joe: Hello! My name is Joe, and I was created by AdAstra Careers to give career advice. What can I help you with today?
</example>
Here is the conversation history (between the user and you) prior to the question. It could be empty if there is no history:
<history>{{HISTORY}}</history>
Here is the user's question:
<question>{{QUESTION}}</question>
How do you respond to the user's question?
Think about your answer first before you respond.
Put your response in <response></response> tags.
Assistant (prefill)
<response>

⸻

Crosswalk Between the Two Structures

Compact Structure	Expanded Structure
1. 1–2 sentences to establish role and high level task description	1. Task context
—	2. Tone context
2. Dynamic / retrieved content	3. Background data, documents, and images
3. Detailed task instructions	4. Detailed task description & rules
4. Examples / n-shot (optional)	5. Examples
—	6. Conversation history
—	7. Immediate task description or request
—	8. Thinking step by step / take a deep breath
—	9. Output formatting
—	10. Prefilled response (if any)
5. Repeat critical instructions, particularly useful for very long prompts	Can be added near the end of the expanded structure

⸻

Final Combined Template

# 1. Role and High-Level Task Description
[1–2 sentences establishing role and high-level task description.]
# 2. Tone Context
[Desired tone.]
# 3. Dynamic / Retrieved Content
[Background data, documents, images, or retrieved content.]
# 4. Detailed Task Instructions and Rules
[Detailed task description and rules.]
# 5. Examples / N-Shot
[Optional examples.]
# 6. Conversation History
[Relevant conversation history, if any.]
# 7. Immediate Task Description or Request
[The current user request.]
# 8. Reasoning Guidance
[Thinking step by step / take a deep breath / think before responding.]
# 9. Output Formatting
[Required response format.]
# 10. Prefilled Response
[Prefilled assistant response, if any.]
# 11. Repeated Critical Instructions
[Repeat critical instructions, particularly useful for very long prompts.]