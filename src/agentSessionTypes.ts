export type AgentSessionMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
};

export type AgentLifecycleStatus = 'running' | 'waiting_input' | 'completed' | 'failed' | 'closed';

export type AgentContextMode = 'none' | 'full' | 'recent_n';

export type AgentRunProfile = 'explore' | 'full';

export type AgentUserInputChoice = {
	label: string;
	description: string;
};

export type AgentUserInputQuestion = {
	id: string;
	header: string;
	question: string;
	options: AgentUserInputChoice[];
};

export type AgentUserInputRequest = {
	requestId: string;
	agentId: string;
	agentTitle: string;
	questions: AgentUserInputQuestion[];
	createdAt: number;
};

export type AgentSessionSnapshotAgent = {
	id: string;
	parentAgentId: string | null;
	parentToolCallId: string;
	title: string;
	subagentType?: string;
	runProfile: AgentRunProfile;
	background: boolean;
	status: AgentLifecycleStatus;
	lastOutputSummary: string;
	lastInputSummary: string;
	lastResultSummary: string;
	lastAssistantFullContent?: string;
	transcriptPath: string | null;
	startedAt: number;
	updatedAt: number;
	closedAt: number | null;
	contextMode: AgentContextMode;
	contextTurns: number | null;
	childAgentIds: string[];
	lastError: string | null;
	messages: AgentSessionMessage[];
	liveThinking?: string;
	liveOutput?: string;
	liveAssistantContent?: string;
};

export type AgentSessionSnapshot = {
	agents: Record<string, AgentSessionSnapshotAgent>;
	pendingUserInput: AgentUserInputRequest | null;
};
