<session>
<harnessVariable>{{sessionContent=Example first user message}}</harnessVariable>
</session>

Write the title in the predominant language of the session — a stray word or code token in another language doesn't change it, and neither does the English of these instructions.

<!-- output_config.format -->
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string"
      }
    },
    "required": [
      "title"
    ],
    "additionalProperties": false
  }
}
