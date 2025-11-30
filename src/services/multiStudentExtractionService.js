
const openaiVisionParser = require('./openaiVisionParser');
const googleDriveService = require('./googleDriveService');

// Toggle for testing without API credits (set to false when credits are available)
const USE_HARDCODED_RESPONSE = false; // Set to true for testing without API credits

/**
 * Analyze a multi-student PDF and detect which pages belong to which students
 * @param {string} pdfUrl - Google Drive link to the combined PDF
 * @param {object} assessmentContext - Assessment details for context
 * @returns {Promise<object>} - Grouped student data with page ranges
 */
async function analyzeMultiStudentPDF(pdfUrl, assessmentContext) {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('📚 MULTI-STUDENT PDF ANALYSIS - STARTING');
        console.log('='.repeat(80));
        console.log('📂 PDF URL:', pdfUrl);
        console.log('📋 Assessment Context:', JSON.stringify(assessmentContext, null, 2));
        console.log('⏰ Start Time:', new Date().toISOString());
        console.log('='.repeat(80) + '\n');
        
        const prompt = buildMultiStudentPrompt(assessmentContext);
        
        // Log the complete prompt
        console.log('\n' + '='.repeat(80));
        console.log('🤖 AI PROMPT FOR MULTI-STUDENT DETECTION:');
        console.log('='.repeat(80));
        console.log(prompt);
        console.log('='.repeat(80) + '\n');
        
        let aiResponse;
        
        if (USE_HARDCODED_RESPONSE) {
            console.log('⚠️  TESTING MODE: Using HARDCODED multi-student detection response');
            
            // Hardcoded response simulating 2 students detected
            // Tuple format: [page_number, student_name, student_identifier, roll_number, class]
            aiResponse = JSON.stringify([
                [1, "Rajat Gupta", "2024-ADM-001", "15", "10B"],
                [2, "Unez Kazy", "2024-ADM-002", "16", "10B"]
            ]);
            
            console.log('📝 Hardcoded response created for 2 students (tuple format)');
        } else {
            // Call AI to analyze all pages
            console.log('📡 Calling AI vision service...');
            aiResponse = await openaiVisionParser.parseWithVision([pdfUrl], prompt);
        }
        
        // Log the complete AI response
        console.log('\n' + '='.repeat(80));
        console.log('🤖 AI RESPONSE (RAW):');
        console.log('='.repeat(80));
        console.log(aiResponse);
        console.log('='.repeat(80) + '\n');
        
        // Parse the AI response
        console.log('📝 Parsing AI response...');
        const pageAnalysis = parseAIResponse(aiResponse);
        
        console.log('\n' + '='.repeat(80));
        console.log('📄 PARSED PAGE ANALYSIS:');
        console.log('='.repeat(80));
        console.log(JSON.stringify(pageAnalysis, null, 2));
        console.log('='.repeat(80) + '\n');
        
        // Group pages by student
        console.log('👥 Grouping pages by student...');
        const groupedStudents = groupPagesByStudent(pageAnalysis);
        
        console.log('\n' + '='.repeat(80));
        console.log('👥 GROUPED STUDENTS:');
        console.log('='.repeat(80));
        groupedStudents.forEach((student, index) => {
            console.log(`\nStudent ${index + 1}:`);
            console.log(`  Name: ${student.student_name}`);
            console.log(`  ID: ${student.student_identifier || 'N/A'}`);
            console.log(`  Roll: ${student.roll_number || 'N/A'}`);
            console.log(`  Pages: [${student.page_numbers.join(', ')}] (${student.total_pages} pages)`);
            console.log(`  Confidence: ${(student.avg_confidence * 100).toFixed(1)}%`);
        });
        console.log('='.repeat(80) + '\n');
        
        console.log(`✅ Detected ${groupedStudents.length} students in PDF`);
        
        return {
            success: true,
            totalPages: pageAnalysis.length,
            studentsDetected: groupedStudents.length,
            students: groupedStudents,
            rawAnalysis: pageAnalysis
        };
        
    } catch (error) {
        console.error('❌ Error analyzing multi-student PDF:', error);
        throw error;
    }
}

/**
 * Build AI prompt for multi-student detection
 */
function buildMultiStudentPrompt(assessmentContext) {
    return `You are analyzing a PDF containing answer sheets from multiple students for the same assessment.

**Assessment Context:**
- Title: ${assessmentContext.title || 'Not provided'}
- Class: ${assessmentContext.class || 'Not provided'}
- Subject: ${assessmentContext.subject || 'Not provided'}

**Your Task:**
Analyze EACH PAGE of this PDF and identify:
1. Which student the page belongs to
2. If this is the first page of a new student (student name/ID header visible)

**IMPORTANT:**
- Each student typically has their name/ID on the FIRST page of their answer sheet
- Subsequent pages may not have student info but belong to the same student
- Look for clear indicators like: "Student Name:", "Roll No:", "Admission No:"
- If a page has no student info, it belongs to the previous student

**Output Format:**
Return as array of tuples (NOT objects) to save tokens:

[
  [1, "Ravi Kumar", "2024-ADM-001", "15", "10B"],
  [2, "Ravi Kumar", "2024-ADM-001", "15", "10B"],
  [3, "Priya Singh", "2024-ADM-002", "16", "10B"]
]

Format: [page_number, student_name, student_identifier, roll_number, class]

**Guidelines:**
- page_number: Integer page number (1, 2, 3...)
- student_name: Full name as written on page (use PREVIOUS student's name if page has no header)
- student_identifier: Student ID/Admission number (use PREVIOUS if not visible)
- roll_number: Roll number (use PREVIOUS if not visible)
- class: Class/Grade (e.g., "10B", "Class 10") - use from header or assessment context

**IMPORTANT:**
- First page of each student has name/ID header
- Continuation pages: use same student info as previous page
- Detect new student when you see a NEW name/ID header

Return ONLY the array of tuples, no additional text or markdown.`;
}

/**
 * Parse AI response into structured page analysis
 * Handles tuple format: [page_number, student_name, student_identifier, roll_number, is_new_student, confidence, notes]
 */
function parseAIResponse(aiResponse) {
    try {
        // Extract JSON from response (might be in code blocks)
        const jsonMatch = aiResponse.match(/```json\n?([\s\S]*?)\n?```/) ||
                         aiResponse.match(/```\n?([\s\S]*?)\n?```/) ||
                         aiResponse.match(/\[[\s\S]*\]/);
        
        const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiResponse;
        const tupleArray = JSON.parse(jsonString);
        
        if (!Array.isArray(tupleArray)) {
            throw new Error('AI response is not an array');
        }
        
        // Convert tuples to objects
        const pageAnalysis = tupleArray.map((tuple, index) => {
            // Handle both tuple format and legacy object format
            if (Array.isArray(tuple)) {
                // Tuple format: [page_number, student_name, student_identifier, roll_number, class]
                const [page_number, student_name, student_identifier, roll_number, student_class] = tuple;
                return {
                    page_number: page_number || (index + 1),
                    student_name: student_name || 'Unknown',
                    student_identifier: student_identifier || null,
                    roll_number: roll_number || null,
                    class: student_class || null
                };
            } else {
                // Legacy object format (for backward compatibility)
                return {
                    page_number: tuple.page_number || (index + 1),
                    student_name: tuple.student_name || 'Unknown',
                    student_identifier: tuple.student_identifier || null,
                    roll_number: tuple.roll_number || null,
                    class: tuple.class || null
                };
            }
        });
        
        return pageAnalysis;
        
    } catch (error) {
        console.error('❌ Failed to parse AI response:', error);
        console.error('Raw response:', aiResponse);
        throw new Error('Failed to parse multi-student detection results: ' + error.message);
    }
}

/**
 * Group pages by student
 */
function groupPagesByStudent(pageAnalysis) {
    const students = [];
    let currentStudent = null;
    
    pageAnalysis.forEach(page => {
        // Detect new student by checking if name or identifier changed
        const isNewStudent = !currentStudent ||
                            (page.student_name && page.student_name !== currentStudent.student_name) ||
                            (page.student_identifier && page.student_identifier !== currentStudent.student_identifier);
        
        if (isNewStudent) {
            // Start new student group
            if (currentStudent) {
                students.push(currentStudent);
            }
            
            currentStudent = {
                student_name: page.student_name || 'Unknown Student',
                student_identifier: page.student_identifier || null,
                roll_number: page.roll_number || null,
                class: page.class || null,
                page_numbers: [page.page_number],
                total_pages: 1,
                pages: [page]
            };
        } else if (currentStudent) {
            // Add page to current student (continuation page)
            currentStudent.page_numbers.push(page.page_number);
            currentStudent.total_pages++;
            currentStudent.pages.push(page);
        }
    });
    
    // Don't forget the last student
    if (currentStudent) {
        students.push(currentStudent);
    }
    
    return students;
}

/**
 * Validate and refine student groupings
 * (Can be called after AI processing to apply business rules)
 */
function validateStudentGroupings(students, options = {}) {
    const {
        minPagesPerStudent = 1,
        maxPagesPerStudent = 20,
        minConfidence = 0.5
    } = options;
    
    const warnings = [];
    
    students.forEach((student, index) => {
        // Check page count
        if (student.total_pages < minPagesPerStudent) {
            warnings.push({
                studentIndex: index,
                type: 'low_page_count',
                message: `Student "${student.student_name}" has only ${student.total_pages} page(s)`,
                severity: 'warning'
            });
        }
        
        if (student.total_pages > maxPagesPerStudent) {
            warnings.push({
                studentIndex: index,
                type: 'high_page_count',
                message: `Student "${student.student_name}" has ${student.total_pages} pages (unusually high)`,
                severity: 'warning'
            });
        }
        
        // Check confidence
        if (student.avg_confidence < minConfidence) {
            warnings.push({
                studentIndex: index,
                type: 'low_confidence',
                message: `Low confidence (${(student.avg_confidence * 100).toFixed(0)}%) for "${student.student_name}"`,
                severity: 'warning'
            });
        }
        
        // Check for missing identifiers
        if (!student.student_identifier) {
            warnings.push({
                studentIndex: index,
                type: 'missing_identifier',
                message: `Student "${student.student_name}" is missing ID/identifier`,
                severity: 'error'
            });
        }
    });
    
    return {
        isValid: warnings.filter(w => w.severity === 'error').length === 0,
        warnings,
        students
    };
}

module.exports = {
    analyzeMultiStudentPDF,
    validateStudentGroupings,
    groupPagesByStudent
};
