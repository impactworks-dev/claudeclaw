on run argv
	if (count of argv) is 0 then return ""
	set qry to item 1 of argv
	set normalized to ""
	repeat with c in (characters of qry)
		set ch to c as string
		if ch is in {"0","1","2","3","4","5","6","7","8","9","+","@","."} then
			set normalized to normalized & ch
		end if
	end repeat

	tell application "Contacts"
		try
			-- Try phone match first
			set foundPeople to (every person whose value of phones contains qry)
			if (count of foundPeople) is 0 then
				-- Try without "+"
				set noPlus to my stripPlus(qry)
				if noPlus is not qry then
					set foundPeople to (every person whose value of phones contains noPlus)
				end if
			end if
			if (count of foundPeople) is 0 then
				-- Try email
				set foundPeople to (every person whose value of emails contains qry)
			end if
			if (count of foundPeople) > 0 then
				set p to item 1 of foundPeople
				set fn to first name of p
				set ln to last name of p
				set on to organization of p
				if fn is missing value then set fn to ""
				if ln is missing value then set ln to ""
				if on is missing value then set on to ""
				if fn is not "" and ln is not "" then
					return fn & " " & ln
				else if fn is not "" then
					return fn
				else if ln is not "" then
					return ln
				else if on is not "" then
					return on
				end if
			end if
		on error errMsg
			return "ERR:" & errMsg
		end try
	end tell
	return ""
end run

on stripPlus(s)
	set out to ""
	repeat with c in (characters of s)
		set ch to c as string
		if ch is not "+" then set out to out & ch
	end repeat
	return out
end stripPlus
