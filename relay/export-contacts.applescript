-- Export Contacts.app entries to JSON for the messages relay.
-- Each row: { name, org, phones: [...], emails: [...] }
-- Normalizes phone numbers (strips spaces / dashes / parens) so they match
-- iMessage handles like +15551234567 directly.

on normalizePhone(p)
	set result to ""
	repeat with c in (characters of p)
		set ch to c as string
		if ch is in {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+"} then
			set result to result & ch
		end if
	end repeat
	return result
end normalizePhone

on escape(s)
	-- Escape backslash, double quote, newline, tab for JSON
	set out to ""
	repeat with i from 1 to length of s
		set c to character i of s
		if c is "\\" then
			set out to out & "\\\\"
		else if c is "\"" then
			set out to out & "\\\""
		else if id of c is 10 then
			set out to out & "\\n"
		else if id of c is 13 then
			set out to out & "\\n"
		else if id of c is 9 then
			set out to out & "\\t"
		else if id of c < 32 then
			-- skip control chars
		else
			set out to out & c
		end if
	end repeat
	return out
end escape

tell application "Contacts"
	set lines to {}
	repeat with p in (every person)
		set fn to first name of p
		set ln to last name of p
		set on to organization of p
		set nick to nickname of p
		if fn is missing value then set fn to ""
		if ln is missing value then set ln to ""
		if on is missing value then set on to ""
		if nick is missing value then set nick to ""

		set fullName to ""
		if fn is not "" and ln is not "" then
			set fullName to fn & " " & ln
		else if fn is not "" then
			set fullName to fn
		else if ln is not "" then
			set fullName to ln
		else if on is not "" then
			set fullName to on
		else if nick is not "" then
			set fullName to nick
		end if

		if fullName is "" then
			-- skip nameless entries
		else
			set phonesJson to "["
			set sep to ""
			repeat with ph in (phones of p)
				try
					set v to value of ph
					if v is not missing value and v is not "" then
						set normalized to my normalizePhone(v as string)
						if normalized is not "" then
							set phonesJson to phonesJson & sep & "\"" & normalized & "\""
							set sep to ","
						end if
					end if
				end try
			end repeat
			set phonesJson to phonesJson & "]"

			set emailsJson to "["
			set sep to ""
			repeat with em in (emails of p)
				try
					set v to value of em
					if v is not missing value and v is not "" then
						set emailsJson to emailsJson & sep & "\"" & my escape(v as string) & "\""
						set sep to ","
					end if
				end try
			end repeat
			set emailsJson to emailsJson & "]"

			set rec to "{\"name\":\"" & my escape(fullName) & "\",\"org\":\"" & my escape(on as string) & "\",\"phones\":" & phonesJson & ",\"emails\":" & emailsJson & "}"
			set end of lines to rec
		end if
	end repeat
end tell

set AppleScript's text item delimiters to ","
set jsonArr to "[" & (lines as string) & "]"
set AppleScript's text item delimiters to ""

-- Write to file
set targetPath to (POSIX path of (path to home folder)) & "claudeclaw/relay/contacts.json"
do shell script "cat > " & quoted form of targetPath & " <<'EOF'" & return & jsonArr & return & "EOF"

return "exported " & (count of lines) & " contacts to " & targetPath
