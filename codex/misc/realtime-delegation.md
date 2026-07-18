<realtime_delegation>
<harnessVariable>
{{#if transcriptTailFlush}}
  <source>transcript_tail_flush</source>
{{/if}}
  <input>{{input}}</input>
{{#if transcriptDelta}}
  <transcript_delta>{{transcriptDelta}}</transcript_delta>
{{/if}}
</harnessVariable>
</realtime_delegation>
