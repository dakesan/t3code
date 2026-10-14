import { useAtomValue } from "@effect/atom-react";
import {
  idleCompactionState,
  idleCompactionMinutesRemaining,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { environmentThreadDetails } from "../../state/threads";

export function IdleCompactionNotice({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const thread = useAtomValue(environmentThreadDetails.threadAtom({ environmentId, threadId }));
  const state = useMemo(() => (thread ? idleCompactionState(thread.projection) : null), [thread]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = state ? idleCompactionMinutesRemaining(state.deadline, now) : null;
  if (minutes === null) return null;
  return (
    <View className="px-4 py-2">
      <Text className="text-xs text-muted-foreground" accessibilityLiveRegion="polite">
        {minutes > 0
          ? `Auto-compact in ${minutes} min. Sending a prompt resets the timer.`
          : state?.blocked
            ? "Auto-compact pending: waiting for current work to finish."
            : "Auto-compact is due."}
      </Text>
    </View>
  );
}
